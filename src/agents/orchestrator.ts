import fs from 'node:fs';
import path from 'node:path';
import type { AgentRole, Checkpoint, ContextPack, ReviewFinding, Task, TaskNode } from '../core/types.js';
import { loadConfig } from '../core/config.js';
import { Store, type PatchLifecycle } from '../storage/db.js';
import { NvidiaClient } from '../models/nvidia.js';
import { ModelRouter } from '../models/router.js';
import { ContextRouter } from '../context/router.js';
import { GitManager } from '../git/worktrees.js';
import { ReviewEngine } from '../reviews/engine.js';
import { LlmReviewer } from '../reviews/llm.js';
import { TaskPlanner, readyNodes, resumeStatus } from '../core/planner.js';
import { LearningLoop } from '../core/learning.js';
import { AgentRuntime } from './runtime.js';
import { MediaService } from '../media/service.js';

export function deferredReviewFinding(error:unknown):ReviewFinding {
  const message=error instanceof Error?error.message:String(error);
  return {id:'REVIEW-DEFERRED',category:'other',severity:'medium',source:'reviewer',evidence:message,rationale:'Deterministic checks passed, but the remote reviewer did not respond before its bounded deadline.',recommendation:'Run review:llm later when the configured reviewer is available.'};
}

export class Orchestrator {
  readonly config=loadConfig(); readonly store=new Store(this.config.dataDir); readonly context=new ContextRouter(process.cwd()); readonly git=new GitManager(process.cwd(),this.config.worktreeDir); readonly nvidia=new NvidiaClient(this.config.nvidia.baseUrl,this.config.nvidia.apiKey,this.config.requestTimeoutMs); readonly router=new ModelRouter(this.config.profiles,this.store.modelHealth(),this.config.modelCooldownMs,state=>this.store.saveModelHealth(state)); readonly reviewEngine=new ReviewEngine(this.config.fallowCommand,this.config.coderabbitEnabled,this.config.coderabbitCommand); readonly planner=new TaskPlanner(); readonly learningLoop=new LearningLoop(this.store); readonly media=new MediaService(this.router,this.nvidia,this.store,this.config.artifactsDir,this.config.requestTimeoutMs);
  private runtimeFor(root:string){return new AgentRuntime(root,this.store,new ContextRouter(root),this.router,this.nvidia,this.learningLoop,this.config.maxConcurrency,this.config.artifactsDir,this.config.budgets,this.config.researcherTimeoutMs,this.config.builderTimeoutMs);}
  createTask(task:Task){this.store.upsertTask(task);return task.id;} showTask(id:string){return this.store.getTask(id);} listTasks(){return this.store.listTasks();}
  async checkpoint(taskId:string,cp:Checkpoint){this.store.addCheckpoint(cp);this.store.setStatus(taskId,'checkpointed');}
  async smoke(role:AgentRole='builder'){
    const candidates=this.router.route({role,effort:'low',allowDegraded:true});
    if(!candidates.length) throw new Error(`No available ${role} model configured`);
    const failures:string[]=[];
    for(const model of candidates.slice(0,2)){
      try{
        const r=await this.nvidia.chat(model.model,[{role:'user',content:`Reply with exactly: ACP ${role} connection OK`}],{maxTokens:32,temperature:0,effort:'low'});
        this.router.markHealth(model.id,'healthy');
        return {role,model:model.model,profile:model.id,text:r.text,usage:r.usage};
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        failures.push(`${model.id}: ${message}`);
        const status=(error as {status?:number}).status;
        if(status===404||status===410) this.router.markHealth(model.id,'unavailable',message);
        else if([429,500,502,503,504].includes(status??0)) this.router.markHealth(model.id,'degraded',message);
        else this.router.markHealth(model.id,'degraded',message);
      }
    }
    throw new Error(`All configured NVIDIA ${role} models failed smoke test\n${failures.join('\n')}`);
  }
  private async reviewWithFallback(task:Task,context:ContextPack,evidence:unknown) {
    const candidates=this.router.route({role:'reviewer',effort:task.effort??'medium',allowDegraded:true});
    if(!candidates.length) throw new Error('No available reviewer model configured');
    let lastError='';
    for(const profile of candidates.slice(0,1)) {
      try { return await new LlmReviewer(this.nvidia,profile.model,this.config.reviewerTimeoutMs).review(context,evidence); }
      catch(error) {
        lastError=error instanceof Error?error.message:String(error);
        if((error as {retryable?:boolean}).retryable) { this.router.markHealth(profile.id,'degraded',lastError); continue; }
        throw error;
      }
    }
    const failure=Object.assign(new Error(`Primary reviewer model failed: ${lastError}`),{retryable:true});
    throw failure;
  }
  buildPlan(taskId:string){const record=this.showTask(taskId);if(!record)throw new Error('Task not found');return this.planner.plan(record.task);}
  taskProgress(taskId:string) {
    const record=this.showTask(taskId); if(!record) throw new Error('Task not found');
    const nodes=this.planner.plan(record.task); const status=resumeStatus(nodes,nodeId=>this.store.latestCheckpoint(taskId,nodeId));
    const completed=nodes.filter(node=>status.get(node.id)==='passed').map(node=>node.id);
    const ready=readyNodes(nodes,status).map(node=>node.id);
    return {taskId,status:record.status,completed,ready,nodes:nodes.map(node=>{
      const checkpoint=this.store.latestCheckpoint(taskId,node.id);
      return {id:node.id,title:node.title,role:node.role,status:status.get(node.id)==='passed'?'completed':'pending',checkpoint:checkpoint?{phase:checkpoint.phase,tests:{status:checkpoint.tests.status},nextAction:checkpoint.next_action}:undefined};
    })};
  }
  async resume(taskId:string) {
    const progress=this.taskProgress(taskId);
    if(progress.status==='passed') return {status:'passed',resumed:false,message:'Task is already complete.',progress};
    return this.run(taskId);
  }
  async run(taskId:string){
    const record=this.showTask(taskId);
    if(!record) throw new Error('Task not found');
    const task=record.task;
    const prepared=await this.git.prepareWorktree(taskId);
    const worktree=prepared.path;
    const executionContext=new ContextRouter(worktree);
    const runtime=this.runtimeFor(worktree);
    const nodes=this.planner.plan(task);
    this.store.setStatus(taskId,'running');
    const status=resumeStatus(nodes,nodeId=>this.store.latestCheckpoint(taskId,nodeId));
    const resumedFrom=nodes.filter(node=>status.get(node.id)==='passed').map(node=>node.id); const executed:string[]=[];
    let progress=true;
    while(progress){
      progress=false;
      const ready=readyNodes(nodes,status);
      if(!ready.length) break;
      const maxAgents=Math.min(task.execution?.maxConcurrency ?? this.config.maxConcurrency, task.budget?.maxAgents ?? this.config.budgets[task.effort ?? 'medium'].maxAgents);
      const batch=(task.execution?.strategy==='parallel'||task.execution?.strategy==='swarm') ? ready.slice(0,maxAgents) : ready.slice(0,1);
      const results=await Promise.all(batch.map(async node=>{
        executed.push(node.id);
        status.set(node.id,'running');
        const cp:Checkpoint={
          task_id:task.id,node_id:node.id,phase:node.role,
          completed:[...status.entries()].filter(([,s])=>s==='passed').map(([id])=>id),
          current:node.objective,changed:[],tests:{status:'pending'},blockers:[],next_action:'Execute node'
        };
        this.store.addCheckpoint(cp);
        const result=await runtime.execute(task,node);
        status.set(node.id,result.ok?'passed':'failed');
        this.store.addCheckpoint({
          ...cp,
          completed:[...status.entries()].filter(([,s])=>s==='passed').map(([id])=>id),
          current:node.title,
          tests:{status:result.ok?'passed':'failed',summary:result.summary.slice(0,1000)},
          next_action:result.ok?'Continue dependency graph':'Resume with recovery model',
          usage:result.usage
        });
        return {node,result};
      }));
      progress=true;
      if(results.some(x=>!x.result.ok)){
        this.store.setStatus(taskId,'checkpointed');
        return {status:'checkpointed',worktree,dependenciesInstalled:prepared.dependenciesInstalled,worktreeSynchronized:prepared.synchronized,resume:{skipped:resumedFrom,executed},nodes:results};
      }
    }
    this.store.setStatus(taskId,'review');
    const report=await this.reviewEngine.deterministic(worktree);
    for(const f of report.findings) this.store.addFinding(taskId,f);
    if(!report.passed){
      this.learningLoop.ingest(taskId,'deterministic-review',report.findings);
      this.store.setStatus(taskId,'failed');
      return {status:'failed',worktree,dependenciesInstalled:prepared.dependenciesInstalled,worktreeSynchronized:prepared.synchronized,resume:{skipped:resumedFrom,executed},report};
    }
    if(task.review.required.includes('reviewer')){
      try{
        const cp=this.store.latestCheckpoint(taskId);
        const context=executionContext.build(task,cp);
        const findings=await this.reviewWithFallback(record.task,context,report.evidence);
        for(const f of findings) this.store.addFinding(taskId,f);
        this.learningLoop.ingest(taskId,'reviewer',findings);
        if(findings.some(f=>['critical','high'].includes(f.severity))){
          this.store.setStatus(taskId,'failed');
          return {status:'failed',worktree,dependenciesInstalled:prepared.dependenciesInstalled,worktreeSynchronized:prepared.synchronized,resume:{skipped:resumedFrom,executed},report,findings};
        }
      }catch(error){
        if((error as {retryable?:boolean}).retryable) {
          const finding=deferredReviewFinding(error);
          this.store.addFinding(taskId,finding);
          this.learningLoop.ingest(taskId,'reviewer',[finding]);
          this.store.setStatus(taskId,'passed');
          return {status:'passed',worktree,dependenciesInstalled:prepared.dependenciesInstalled,worktreeSynchronized:prepared.synchronized,resume:{skipped:resumedFrom,executed},report,findings:this.store.findings(taskId),reviewDeferred:true};
        }
        this.store.setStatus(taskId,'checkpointed');
        return {status:'checkpointed',worktree,dependenciesInstalled:prepared.dependenciesInstalled,worktreeSynchronized:prepared.synchronized,resume:{skipped:resumedFrom,executed},reason:error instanceof Error?error.message:String(error)};
      }
    }
    this.store.setStatus(taskId,'passed');
    return {status:'passed',worktree,dependenciesInstalled:prepared.dependenciesInstalled,worktreeSynchronized:prepared.synchronized,resume:{skipped:resumedFrom,executed},report,findings:this.store.findings(taskId)};
  }
  learning(taskId:string){return this.store.learning(taskId);}
  proposeUpgrade(taskId:string,maxIterations=1){return this.learningLoop.proposeUpgrade(taskId,maxIterations);}
  approveUpgrade(id:number){this.learningLoop.approveUpgrade(id);}
  validateUpgrade(id:number){this.learningLoop.markUpgradeValidated(id);}
  applyUpgrade(id:number){this.learningLoop.markUpgradeApplied(id);}
  rejectUpgrade(id:number){this.learningLoop.rejectUpgrade(id);}
  rollbackUpgrade(id:number){this.learningLoop.rollbackUpgrade(id);}
  upgrades(status?:any){return this.learningLoop.upgrades(status);}
  approveLearning(taskId:string,iterationId:number){this.learningLoop.humanApprove(taskId,iterationId);}
  artifacts(taskId:string){return this.store.artifacts(taskId);}
  private patchArtifact(taskId:string,artifactId?:string) {
    const patches=this.artifacts(taskId).filter((artifact:any)=>artifact.type==='patch') as Array<{id:string;task_id:string;path:string;metadata?:string}>;
    const artifact=artifactId?patches.find(item=>item.id===artifactId):patches[0];
    if(!artifact) throw new Error(`No patch artifact found for ${taskId}`);
    if(!fs.existsSync(artifact.path)) throw new Error(`Patch artifact is missing: ${artifact.path}`);
    return artifact;
  }
  patches(taskId:string){return this.artifacts(taskId).filter((artifact:any)=>artifact.type==='patch').map((artifact:any)=>({...artifact,lifecycle:this.store.patchLifecycle(artifact.id)}));}
  showPatch(taskId:string,artifactId?:string){const artifact=this.patchArtifact(taskId,artifactId);return {...artifact,text:fs.readFileSync(artifact.path,'utf8'),lifecycle:this.store.patchLifecycle(artifact.id)};}
  async validatePatch(taskId:string,artifactId?:string) {
    const record=this.showTask(taskId); if(!record) throw new Error(`Unknown task ${taskId}`);
    const artifact=this.patchArtifact(taskId,artifactId); const worktree=await this.git.ensureWorktree(taskId);
    const validation=await this.git.validatePatch(worktree,artifact.path,record.task.scope.allowed);
    this.store.savePatchLifecycle({artifactId:artifact.id,taskId,worktree,status:validation.valid?'validated':'rejected',validation});
    return {artifactId:artifact.id,worktree,...validation};
  }
  approvePatch(taskId:string,artifactId:string) {
    const lifecycle=this.store.patchLifecycle(artifactId);
    if(!lifecycle||lifecycle.taskId!==taskId||lifecycle.status!=='validated') throw new Error('Patch must pass validation before approval');
    const approved={...lifecycle,status:'approved' as const,approvedAt:new Date().toISOString()}; this.store.savePatchLifecycle(approved); return approved;
  }
  async applyPatch(taskId:string,artifactId:string) {
    const lifecycle=this.store.patchLifecycle(artifactId);
    if(!lifecycle||lifecycle.taskId!==taskId||lifecycle.status!=='approved') throw new Error('Patch requires explicit approval before apply');
    const artifact=this.patchArtifact(taskId,artifactId); const record=this.showTask(taskId); if(!record) throw new Error(`Unknown task ${taskId}`);
    const validation=await this.git.validatePatch(lifecycle.worktree,artifact.path,record.task.scope.allowed);
    if(!validation.valid) { this.store.savePatchLifecycle({...lifecycle,status:'rejected',validation}); throw new Error(`Patch validation failed before apply: ${validation.reason}`); }
    await this.git.applyPatch(lifecycle.worktree,artifact.path);
    const applied={...lifecycle,status:'applied' as const,validation,appliedAt:new Date().toISOString()}; this.store.savePatchLifecycle(applied); return applied;
  }
  mediaModels(){return this.media.models();}
  generateImage(prompt:string,profileId?:string):Promise<{jobId:string;profile:string;model:string;path:string;mimeType:string;seed?:number}>{return this.media.image(prompt,profileId);}
  findings(taskId:string){return this.store.findings(taskId);}
  async deterministicReview(taskId:string){const task=this.showTask(taskId);if(!task)throw new Error(`Unknown task ${taskId}`);this.store.setStatus(taskId,'review');const report=await this.reviewEngine.deterministic(process.cwd());for(const f of report.findings)this.store.addFinding(taskId,f);if(report.passed)this.store.setStatus(taskId,'passed');else{this.learningLoop.ingest(taskId,'deterministic-review',report.findings);this.store.setStatus(taskId,'failed');}return report;}
  async llmReview(taskId:string){const record=this.showTask(taskId);if(!record)throw new Error(`Unknown task ${taskId}`);const context=this.context.build(record.task,this.store.latestCheckpoint(taskId));const evidence=await this.reviewEngine.deterministic(process.cwd());const findings=await this.reviewWithFallback(record.task,context,evidence.evidence);for(const f of findings)this.store.addFinding(taskId,f);this.learningLoop.ingest(taskId,'reviewer',findings);return findings;}
  async externalReview(taskId:string){const task=this.showTask(taskId);if(!task)throw new Error(`Unknown task ${taskId}`);const report=await this.reviewEngine.external(process.cwd());for(const finding of report.findings)this.store.addFinding(taskId,finding);if(!report.passed)this.learningLoop.ingest(taskId,'external-review',report.findings);return report;}
  async ensureWorktree(taskId:string){return this.git.ensureWorktree(taskId);}
  async prepareWorktree(taskId:string){return this.git.prepareWorktree(taskId);}
  writeDesignCandidate(name:string,content:string){const file=path.join(process.cwd(),'design-library','candidates',`${name}.md`);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);return file;}
}
