import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelRouter } from '../src/models/router.js';
import { ContextRouter } from '../src/context/router.js';
import { TaskPlanner, readyNodes } from '../src/core/planner.js';
import { NvidiaClient } from '../src/models/nvidia.js';
import { parseReviewFindings } from '../src/reviews/llm.js';
import { resolveBudget } from '../src/agents/runtime.js';
import { deferredReviewFinding } from '../src/agents/orchestrator.js';

const profiles=[
  {id:'fast',provider:'nvidia',model:'fast',capabilities:['coding','reasoning'],maxConcurrent:2,enabled:true,priority:20},
  {id:'heavy',provider:'nvidia',model:'heavy',capabilities:['coding','reasoning','planning'],maxConcurrent:1,enabled:true,priority:10},
  {id:'dead',provider:'nvidia',model:'dead',capabilities:['coding'],maxConcurrent:1,enabled:true,health:'unavailable' as const}
];

test('model routing is configurable, health-aware and deduplicates candidates',()=>{
  const router=new ModelRouter(profiles);
  const candidates=router.route({role:'builder',preferred:['fast'],fallback:['dead']});
  assert.equal(candidates[0].id,'fast');
  assert.ok(!candidates.some(x=>x.id==='dead'));
  assert.equal(new Set(candidates.map(x=>x.id)).size,candidates.length);
});

test('model routing prefers the profile dedicated to the requested role', () => {
  const router = new ModelRouter([
    { id: 'builder', provider: 'nvidia', model: 'builder-model', capabilities: ['coding', 'reasoning'], maxConcurrent: 1, enabled: true, priority: 10 },
    { id: 'researcher', provider: 'nvidia', model: 'research-model', capabilities: ['research', 'reasoning'], maxConcurrent: 1, enabled: true, priority: 20 },
    { id: 'reviewer', provider: 'nvidia', model: 'builder-model', capabilities: ['review', 'reasoning'], maxConcurrent: 1, enabled: true, priority: 10 }
  ]);
  assert.equal(router.route({ role: 'researcher' })[0].id, 'researcher');
  assert.equal(router.route({ role: 'reviewer' })[0].id, 'reviewer');
});

test('NVIDIA transport failures are retryable so the runtime can fail over', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('socket closed'); };
  try {
    await assert.rejects(
      new NvidiaClient('https://example.test/v1', 'test-key').chat('test-model', [{ role: 'user', content: 'test' }]),
      (error: Error & { retryable?: boolean }) => error.retryable === true && /transport error/i.test(error.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NVIDIA requests time out instead of waiting indefinitely', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
  try {
    await assert.rejects(
      new NvidiaClient('https://example.test/v1', 'test-key', 5).chat('test-model', [{ role: 'user', content: 'test' }]),
      (error: Error & { retryable?: boolean }) => error.retryable === true && /timed out/i.test(error.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reviewer parsing accepts JSON wrapped in model prose or a code fence', () => {
  const raw='Reasoning omitted.\n```json\n{"findings":[{"id":"R-1","category":"testing","severity":"low","source":"reviewer","evidence":"test","rationale":"coverage","recommendation":"add test"}]}\n```';
  assert.equal(parseReviewFindings(raw)?.[0].id, 'R-1');
});

test('runtime budgets use configured presets and preserve task and node overrides', () => {
  const budgets={medium:{maxTokens:100,maxRequests:2,maxDurationMinutes:3,maxAgents:1},high:{maxTokens:200,maxRequests:4,maxDurationMinutes:5,maxAgents:2}};
  const task={id:'TASK-BUDGET',title:'budget',objective:'budget',type:'test',scope:{allowed:['src/**']},acceptance:['works'],review:{required:[]},effort:'high' as const,budget:{maxRequests:3}};
  const node={id:'TASK-BUDGET-build',title:'build',objective:'build',role:'builder' as const,budget:{maxDurationMinutes:1}};
  assert.deepEqual(resolveBudget(budgets,task,node),{maxTokens:200,maxRequests:3,maxDurationMinutes:1,maxAgents:2});
});

test('runtime stops before a model call when request or duration budget is exhausted', async () => {
  const { AgentRuntime } = await import('../src/agents/runtime.js');
  const { Store } = await import('../src/storage/db.js');
  const { LearningLoop } = await import('../src/core/learning.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-runtime-'));
  const store = new Store(path.join(root, 'data'));
  const router = new ModelRouter([{id:'builder',provider:'nvidia',model:'builder-model',capabilities:['coding','reasoning'],maxConcurrent:1,enabled:true}]);
  let calls=0;
  const client={chat:async()=>{calls++;return {text:'ok',usage:{}};}};
  const runtime=new AgentRuntime(root,store,new ContextRouter(process.cwd()),router,client as any,new LearningLoop(store),1,path.join(root,'artifacts'),{medium:{maxTokens:100000,maxRequests:0,maxDurationMinutes:1,maxAgents:1}});
  const task={id:'TASK-LIMIT',title:'limit',objective:'limit',type:'test',scope:{allowed:['src/**']},acceptance:['works'],review:{required:[]},effort:'medium' as const};
  const node={id:'TASK-LIMIT-build',title:'build',objective:'build',role:'builder' as const};
  const result=await runtime.execute(task,node);
  assert.equal(result.ok,false);
  assert.match(result.summary,/Request budget exhausted/);
  assert.equal(calls,0);
  const durationRuntime=new AgentRuntime(root,store,new ContextRouter(process.cwd()),router,client as any,new LearningLoop(store),1,path.join(root,'duration-artifacts'),{medium:{maxTokens:100000,maxRequests:1,maxDurationMinutes:0,maxAgents:1}});
  const durationResult=await durationRuntime.execute(task,node);
  assert.equal(durationResult.ok,false);
  assert.match(durationResult.summary,/Duration budget exhausted/);
  assert.equal(calls,0);
  fs.rmSync(root,{recursive:true,force:true});
});

test('deferred reviews remain visible without being reported as a deterministic failure', () => {
  const finding=deferredReviewFinding(Object.assign(new Error('review timed out'),{retryable:true}));
  assert.equal(finding.id,'REVIEW-DEFERRED');
  assert.equal(finding.severity,'medium');
  assert.match(finding.recommendation,/review:llm/);
});

test('context router returns task-scoped context instead of whole repository',()=>{const router=new ContextRouter(process.cwd());const pack=router.build({id:'TASK-9999',title:'test',objective:'test',type:'test',scope:{allowed:['src/core/**']},acceptance:['works'],review:{required:[]}});assert.equal(pack.task.id,'TASK-9999');assert.ok(pack.docs.some(x=>x.path==='AGENTS.md'));assert.ok(pack.files.length<=20);assert.ok(pack.tokenEstimate>0)});

test('planner creates resumable dependency graph',()=>{const nodes=new TaskPlanner().plan({id:'TASK-0001',title:'x',objective:'x',type:'test',scope:{allowed:['src/**']},acceptance:['x'],review:{required:['reviewer']},effort:'high'});assert.equal(nodes.length,4);assert.deepEqual(readyNodes(nodes,new Map(nodes.map(n=>[n.id,'pending']))).map(n=>n.role),['researcher']);});

test('learning and upgrade lifecycle rejects invalid transitions', async () => {
  const { Store } = await import('../src/storage/db.js');
  const { LearningLoop } = await import('../src/core/learning.js');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-learning-'));
  const store = new Store(dataDir);
  const loop = new LearningLoop(store);
  assert.throws(() => loop.humanApprove('TASK-0001', 999999), /does not exist/);
  const finding = {id:'DUP-1',category:'duplicate' as const,severity:'medium' as const,source:'reviewer' as const,evidence:'same helper exists twice',rationale:'Duplicate abstraction found.',recommendation:'Reuse the existing helper.'};
  store.addFinding('TASK-0001', finding);
  const candidates = loop.proposeUpgrade('TASK-0001', 1);
  assert.equal(candidates.length, 1);
  const id=candidates[0].id;
  assert.throws(() => loop.markUpgradeApplied(id), /Invalid upgrade transition/);
  loop.approveUpgrade(id);
  loop.markUpgradeValidated(id);
  loop.markUpgradeApplied(id);
  assert.equal(loop.upgrades('applied')[0].status, 'applied');
  loop.rollbackUpgrade(id);
  assert.equal(loop.upgrades('rolled_back')[0].status, 'rolled_back');
  fs.rmSync(dataDir, { recursive: true, force: true });
});
