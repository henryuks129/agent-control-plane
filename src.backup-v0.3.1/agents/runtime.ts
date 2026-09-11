import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRole, Budget, Task, TaskNode } from '../core/types.js';
import { ContextRouter } from '../context/router.js';
import { ConcurrencyManager, ModelRouter } from '../models/router.js';
import { NvidiaClient } from '../models/nvidia.js';
import { Store } from '../storage/db.js';
import { LearningLoop } from '../core/learning.js';

function jsonBlock(raw:string):string { const match=raw.match(/```(?:json)?\s*([\s\S]*?)```/i); return (match?.[1]??raw).trim(); }
function extractPatch(raw:string):string|undefined { const match=raw.match(/```diff\s*([\s\S]*?)```/i); return match?.[1]?.trim(); }

export class AgentRuntime {
  private readonly concurrency:ConcurrencyManager;
  constructor(private readonly root:string, private readonly store:Store, private readonly context:ContextRouter, private readonly router:ModelRouter, private readonly client:NvidiaClient, private readonly learning:LearningLoop, maxConcurrency:number, private readonly artifactsDir:string) { this.concurrency=new ConcurrencyManager(maxConcurrency); fs.mkdirSync(artifactsDir,{recursive:true}); }

  private budget(task:Task, node:TaskNode):Budget { const base:Budget={maxTokens:250000,maxRequests:80,maxDurationMinutes:90,maxAgents:5}; const preset:Record<string,Budget>={low:{maxTokens:20000,maxRequests:10,maxDurationMinutes:10,maxAgents:1},medium:{maxTokens:80000,maxRequests:30,maxDurationMinutes:30,maxAgents:2},high:{maxTokens:250000,maxRequests:80,maxDurationMinutes:90,maxAgents:5},maximum:{maxTokens:750000,maxRequests:200,maxDurationMinutes:240,maxAgents:12}}; const b={...base,...preset[task.effort??'medium'],...(task.budget??{}),...(node.budget??{})}; return b; }

  async execute(task:Task,node:TaskNode):Promise<{ok:boolean;summary:string;usage:{inputTokens:number;outputTokens:number}}> {
    const candidates=this.router.candidates(node.role,task.model_preferences?.primary,task.model_preferences?.fallback); if(!candidates.length) throw new Error(`No model available for role ${node.role}`);
    const runId=crypto.randomUUID(); const startedAt=new Date().toISOString(); const budget=this.budget(task,node); let lastError=''; let inputTokens=0,outputTokens=0;
    for(const profile of candidates) {
      if(!profile.enabled)continue; const release=await this.concurrency.acquire(profile); const run={id:runId,taskId:task.id,nodeId:node.id,role:node.role,modelId:profile.id,status:'running' as const,startedAt}; this.store.addAgentRun(run);
      try {
        const cp=this.store.latestCheckpoint(task.id,node.id); const context=this.context.build({...task,scope:node.scope??task.scope,acceptance:node.acceptance??task.acceptance},cp,node.scope?.allowed);
        if(context.tokenEstimate>budget.maxTokens) throw new Error(`Context estimate ${context.tokenEstimate} exceeds task budget ${budget.maxTokens}`);
        const system='You are an ACP worker. Work only within the task scope. Never invent repository facts. Return a concise structured result. For builder tasks, return a unified diff inside a ```diff block and a short summary. Do not include secrets.';
        const user=[`ROLE: ${node.role}`,`TASK: ${node.title}`,`OBJECTIVE: ${node.objective}`,`ACCEPTANCE: ${JSON.stringify(node.acceptance??task.acceptance)}`,`CHECKPOINT: ${JSON.stringify(cp??null)}`,`CONTEXT:\n${JSON.stringify(context)}`].join('\n\n');
        const result=await this.client.chat(profile.model,[{role:'system',content:system},{role:'user',content:user}],{maxTokens:Math.min(12000,budget.maxTokens),temperature:0.1}); inputTokens+=result.usage.prompt_tokens??0; outputTokens+=result.usage.completion_tokens??0;
        const artifactBase=path.join(this.artifactsDir,task.id); fs.mkdirSync(artifactBase,{recursive:true}); const outPath=path.join(artifactBase,`${node.id}.md`); fs.writeFileSync(outPath,result.text); this.store.addArtifact({id:`${task.id}:${node.id}:response`,taskId:task.id,type:'report',path:outPath,metadata:{model:profile.model}});
        const patch=extractPatch(result.text); if(node.role==='builder'&&patch){ const patchPath=path.join(artifactBase,`${node.id}.patch`); fs.writeFileSync(patchPath,patch+'\n'); this.store.addArtifact({id:`${task.id}:${node.id}:patch`,taskId:task.id,type:'patch',path:patchPath}); }
        this.store.updateAgentRun({...run,status:'passed',inputTokens,outputTokens,finishedAt:new Date().toISOString()}); release(); return {ok:true,summary:result.text.slice(-4000),usage:{inputTokens,outputTokens}};
      } catch(error) { lastError=error instanceof Error?error.message:String(error); this.store.updateAgentRun({...run,status:'failed',inputTokens,outputTokens,finishedAt:new Date().toISOString(),error:lastError}); release(); if(!(error as {retryable?:boolean}).retryable) break; }
    }
    this.learning.ingest(task.id,'agent-runtime',[{id:`AGENT-${node.id}`,category:'other',severity:'high',source:'reviewer',evidence:lastError,rationale:'Agent execution failed after configured model candidates.',recommendation:'Resume from the checkpoint using the recovery route.'}]);
    return {ok:false,summary:lastError,usage:{inputTokens,outputTokens}};
  }
}

export { jsonBlock };
