import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRole, Budget, Task, TaskNode } from '../core/types.js';
import { ContextRouter } from '../context/router.js';
import { ConcurrencyManager, ModelRouter } from '../models/router.js';
import { NvidiaClient } from '../models/nvidia.js';
import { Store } from '../storage/db.js';
import { LearningLoop } from '../core/learning.js';
import { DeterministicTestAgent } from './test-agent.js';

function jsonBlock(raw:string):string { const match=raw.match(/```(?:json)?\s*([\s\S]*?)```/i); return (match?.[1]??raw).trim(); }
function extractPatch(raw:string):string|undefined { const match=raw.match(/```diff\s*([\s\S]*?)```/i); return match?.[1]?.trim(); }

function compactPromptContext(context:ReturnType<ContextRouter['build']>) {
  return {
    ...context,
    files:context.files.slice(0,4).map(file=>({...file,content:file.content.slice(0,2500)})),
    docs:context.docs.slice(0,2).map(doc=>({...doc,content:doc.content.slice(0,1500)})),
    design:context.design.slice(0,1).map(reference=>({...reference,content:reference.content.slice(0,1500)}))
  };
}

function responseTokenLimit(role:AgentRole,budget:Budget) {
  const limit=role==='researcher'?600:role==='test'?400:1200;
  return Math.min(limit,budget.maxTokens);
}

export function resolveBudget(budgets:Record<string,Budget>,task:Task,node:TaskNode):Budget {
  const effort=node.effort??task.effort??'medium';
  const preset=budgets[effort]??budgets.medium;
  if(!preset) throw new Error(`No budget configured for effort ${effort}`);
  return {...preset,...(task.budget??{}),...(node.budget??{})};
}

export class AgentRuntime {
  private readonly concurrency:ConcurrencyManager;
  private readonly testAgent:DeterministicTestAgent;
  constructor(private readonly root:string, private readonly store:Store, private readonly context:ContextRouter, private readonly router:ModelRouter, private readonly client:NvidiaClient, private readonly learning:LearningLoop, maxConcurrency:number, private readonly artifactsDir:string, private readonly budgets:Record<string,Budget>, private readonly researcherTimeoutMs=90000, private readonly builderTimeoutMs=90000) { this.concurrency=new ConcurrencyManager(maxConcurrency); this.testAgent=new DeterministicTestAgent(root,store,artifactsDir); fs.mkdirSync(artifactsDir,{recursive:true}); }

  private budget(task:Task, node:TaskNode):Budget { return resolveBudget(this.budgets,task,node); }

  async execute(task:Task,node:TaskNode):Promise<{ok:boolean;summary:string;usage:{inputTokens:number;outputTokens:number;requests:number}}> {
    // The orchestrator performs the authoritative LLM review after the graph
    // completes. Keep graph-level test/review nodes deterministic so a task
    // does not spend two model calls reviewing the same checkout.
    if(node.role==='test') return this.testAgent.execute(task,node);
    if(node.role==='reviewer') return {ok:true,summary:'Review gate reached; authoritative review runs after deterministic evidence is collected.',usage:{inputTokens:0,outputTokens:0,requests:0}};
    const candidates=this.router.route({role:node.role,effort:node.effort??task.effort??'medium',preferred:task.model_preferences?.primary,fallback:task.model_preferences?.fallback,allowDegraded:true}); if(!candidates.length) throw new Error(`No model available for role ${node.role}`);
    const runId=crypto.randomUUID(); const startedAt=new Date().toISOString(); const startedAtMs=Date.now(); const budget=this.budget(task,node); let lastError=''; let inputTokens=0,outputTokens=0,requests=0;
    const attempts=candidates.slice(0,Math.min(candidates.length,Math.max(1,budget.maxRequests),2));
    for(const profile of attempts) {
      if(!profile.enabled || profile.health==='unavailable')continue; const release=await this.concurrency.acquire(profile); const run={id:runId,taskId:task.id,nodeId:node.id,role:node.role,modelId:profile.id,status:'running' as const,startedAt}; this.store.addAgentRun(run);
      try {
        if(requests>=budget.maxRequests) throw new Error(`Request budget exhausted (${budget.maxRequests})`);
        const remainingMs=budget.maxDurationMinutes*60_000-(Date.now()-startedAtMs);
        if(remainingMs<=0) throw new Error(`Duration budget exhausted (${budget.maxDurationMinutes} minutes)`);
        const cp=this.store.latestCheckpoint(task.id,node.id); const context=this.context.build({...task,scope:node.scope??task.scope,acceptance:node.acceptance??task.acceptance},cp,node.scope?.allowed);
        if(context.tokenEstimate>budget.maxTokens) throw new Error(`Context estimate ${context.tokenEstimate} exceeds task budget ${budget.maxTokens}`);
        const system='You are an ACP worker. Work only within the task scope. Never invent repository facts. Return a concise structured result. For builder tasks, return a unified diff inside a ```diff block and a short summary. Do not include secrets.';
        const user=[`ROLE: ${node.role}`,`TASK: ${node.title}`,`OBJECTIVE: ${node.objective}`,`ACCEPTANCE: ${JSON.stringify(node.acceptance??task.acceptance)}`,`CHECKPOINT: ${JSON.stringify(cp??null)}`,`CONTEXT:\n${JSON.stringify(compactPromptContext(context))}`].join('\n\n');
        const timeoutMs=node.role==='researcher'?this.researcherTimeoutMs:node.role==='builder'?this.builderTimeoutMs:undefined;
        requests++; const result=await this.client.chat(profile.model,[{role:'system',content:system},{role:'user',content:user}],{maxTokens:responseTokenLimit(node.role,budget),temperature:0.1,signal:AbortSignal.timeout(remainingMs),timeoutMs,effort:node.effort??task.effort??'medium'}); inputTokens+=result.usage.prompt_tokens??0; outputTokens+=result.usage.completion_tokens??0;
        const artifactBase=path.join(this.artifactsDir,task.id); fs.mkdirSync(artifactBase,{recursive:true}); const outPath=path.join(artifactBase,`${node.id}.md`); fs.writeFileSync(outPath,result.text); this.store.addArtifact({id:`${task.id}:${node.id}:response`,taskId:task.id,type:'report',path:outPath,metadata:{model:profile.model}});
        const patch=extractPatch(result.text); if(node.role==='builder'&&patch){ const patchPath=path.join(artifactBase,`${node.id}.patch`); fs.writeFileSync(patchPath,patch+'\n'); this.store.addArtifact({id:`${task.id}:${node.id}:patch`,taskId:task.id,type:'patch',path:patchPath}); }
        this.store.updateAgentRun({...run,status:'passed',inputTokens,outputTokens,finishedAt:new Date().toISOString()}); release(); return {ok:true,summary:result.text.slice(-4000),usage:{inputTokens,outputTokens,requests}};
      } catch(error) { lastError=error instanceof Error?error.message:String(error); this.store.updateAgentRun({...run,status:'failed',inputTokens,outputTokens,finishedAt:new Date().toISOString(),error:lastError}); release(); if((error as {retryable?:boolean}).retryable) this.router.markHealth(profile.id,'degraded',lastError); else break; }
    }
    this.learning.ingest(task.id,'agent-runtime',[{id:`AGENT-${node.id}`,category:'other',severity:'high',source:'reviewer',evidence:lastError,rationale:'Agent execution failed after configured model candidates.',recommendation:'Resume from the checkpoint using the recovery route.'}]);
    return {ok:false,summary:lastError,usage:{inputTokens,outputTokens,requests}};
  }
}

export { jsonBlock };
