import fs from 'node:fs';
import path from 'node:path';
import type { Checkpoint, Task, TaskNode } from '../core/types.js';
import { loadConfig } from '../core/config.js';
import { Store } from '../storage/db.js';
import { NvidiaClient } from '../models/nvidia.js';
import { ModelRouter } from '../models/router.js';
import { ContextRouter } from '../context/router.js';
import { GitManager } from '../git/worktrees.js';
import { ReviewEngine } from '../reviews/engine.js';
import { LlmReviewer } from '../reviews/llm.js';
import { TaskPlanner, readyNodes } from '../core/planner.js';
import { LearningLoop } from '../core/learning.js';
import { AgentRuntime } from './runtime.js';

export class Orchestrator {
  readonly config=loadConfig(); readonly store=new Store(this.config.dataDir); readonly context=new ContextRouter(process.cwd()); readonly git=new GitManager(process.cwd(),this.config.worktreeDir); readonly nvidia=new NvidiaClient(this.config.nvidia.baseUrl,this.config.nvidia.apiKey); readonly router=new ModelRouter(this.config.profiles); readonly reviewEngine=new ReviewEngine(this.config.fallowCommand); readonly planner=new TaskPlanner(); readonly learningLoop=new LearningLoop(this.store); readonly runtime=new AgentRuntime(process.cwd(),this.store,this.context,this.router,this.nvidia,this.learningLoop,this.config.maxConcurrency,this.config.artifactsDir);
  createTask(task:Task){this.store.upsertTask(task);return task.id;} showTask(id:string){return this.store.getTask(id);} listTasks(){return this.store.listTasks();}
  async checkpoint(taskId:string,cp:Checkpoint){this.store.addCheckpoint(cp);this.store.setStatus(taskId,'checkpointed');}
  async smoke(){const candidates=this.router.candidates('builder');if(!candidates.length)throw new Error('No builder model configured');const model=candidates[0];const r=await this.nvidia.chat(model.model,[{role:'user',content:'Reply with exactly: ACP NVIDIA connection OK'}],{maxTokens:32,temperature:0});return {model:model.model,text:r.text,usage:r.usage};}
  buildPlan(taskId:string){const record=this.showTask(taskId);if(!record)throw new Error('Task not found');return this.planner.plan(record.task);}
  async run(taskId:string){
    const record=this.showTask(taskId);
    if(!record) throw new Error('Task not found');
    const task=record.task;
    const nodes=this.planner.plan(task);
    this.store.setStatus(taskId,'running');
    const status=new Map<string,string>();
    for(const n of nodes) status.set(n.id,'pending');
    for(const n of nodes) { if(this.store.latestCheckpoint(taskId,n.id)?.tests.status==='passed') status.set(n.id,'passed'); }
    let progress=true;
    while(progress){
      progress=false;
      const ready=readyNodes(nodes,status);
      if(!ready.length) break;
      const maxAgents=Math.min(task.execution?.maxConcurrency ?? this.config.maxConcurrency, task.budget?.maxAgents ?? this.config.budgets[task.effort ?? 'medium'].maxAgents);
      const batch=(task.execution?.strategy==='parallel'||task.execution?.strategy==='swarm') ? ready.slice(0,maxAgents) : ready.slice(0,1);
      const results=await Promise.all(batch.map(async node=>{
        status.set(node.id,'running');
        const cp:Checkpoint={
          task_id:task.id,node_id:node.id,phase:node.role,
          completed:[...status.entries()].filter(([,s])=>s==='passed').map(([id])=>id),
          current:node.objective,changed:[],tests:{status:'pending'},blockers:[],next_action:'Execute node'
        };
        this.store.addCheckpoint(cp);
        const result=await this.runtime.execute(task,node);
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
        return {status:'checkpointed',nodes:results};
      }
    }
    this.store.setStatus(taskId,'review');
    const report=await this.reviewEngine.deterministic(process.cwd());
    for(const f of report.findings) this.store.addFinding(taskId,f);
    if(!report.passed){
      this.learningLoop.ingest(taskId,'deterministic-review',report.findings);
      this.store.setStatus(taskId,'failed');
      return {status:'failed',report};
    }
    if(task.review.required.includes('reviewer')){
      try{
        const cp=this.store.latestCheckpoint(taskId);
        const context=this.context.build(task,cp);
        const reviewer=new LlmReviewer(this.nvidia,this.config.models.reviewer);
        const findings=await reviewer.review(context,report.evidence);
        for(const f of findings) this.store.addFinding(taskId,f);
        this.learningLoop.ingest(taskId,'reviewer',findings);
        if(findings.some(f=>['critical','high'].includes(f.severity))){
          this.store.setStatus(taskId,'failed');
          return {status:'failed',report,findings};
        }
      }catch(error){
        this.store.setStatus(taskId,'checkpointed');
        return {status:'checkpointed',reason:error instanceof Error?error.message:String(error)};
      }
    }
    this.store.setStatus(taskId,'passed');
    return {status:'passed',report,findings:this.store.findings(taskId)};
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
  findings(taskId:string){return this.store.findings(taskId);}
  async deterministicReview(taskId:string){const task=this.showTask(taskId);if(!task)throw new Error(`Unknown task ${taskId}`);this.store.setStatus(taskId,'review');const report=await this.reviewEngine.deterministic(process.cwd());for(const f of report.findings)this.store.addFinding(taskId,f);if(report.passed)this.store.setStatus(taskId,'passed');else{this.learningLoop.ingest(taskId,'deterministic-review',report.findings);this.store.setStatus(taskId,'failed');}return report;}
  async llmReview(taskId:string){const record=this.showTask(taskId);if(!record)throw new Error(`Unknown task ${taskId}`);const context=this.context.build(record.task,this.store.latestCheckpoint(taskId));const evidence=await this.reviewEngine.deterministic(process.cwd());const reviewer=new LlmReviewer(this.nvidia,this.config.models.reviewer);const findings=await reviewer.review(context,evidence.evidence);for(const f of findings)this.store.addFinding(taskId,f);this.learningLoop.ingest(taskId,'reviewer',findings);return findings;}
  async ensureWorktree(taskId:string){return this.git.ensureWorktree(taskId);}
  writeDesignCandidate(name:string,content:string){const file=path.join(process.cwd(),'design-library','candidates',`${name}.md`);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);return file;}
}
