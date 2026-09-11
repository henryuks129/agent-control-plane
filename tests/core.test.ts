import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ModelRouter } from '../src/models/router.js';
import { ContextRouter } from '../src/context/router.js';
import { TaskPlanner, readyNodes } from '../src/core/planner.js';
import { NvidiaClient } from '../src/models/nvidia.js';
import { parseReviewFindings } from '../src/reviews/llm.js';
import { resolveBudget } from '../src/agents/runtime.js';
import { deferredReviewFinding } from '../src/agents/orchestrator.js';
import { GitManager } from '../src/git/worktrees.js';
import { MediaService } from '../src/media/service.js';

const exec=promisify(execFile);

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

test('media routing selects only the requested image capability', () => {
  const router=new ModelRouter([
    {id:'chat',provider:'nvidia',model:'chat-model',capabilities:['coding'],maxConcurrent:1,enabled:true},
    {id:'image',provider:'nvidia',model:'image-model',capabilities:['text-to-image'],maxConcurrent:1,enabled:true,priority:10,media:{kind:'image',endpoint:'https://example.test/image'}}
  ]);
  assert.deepEqual(router.mediaCandidates('text-to-image').map(p=>p.id),['image']);
});

test('media routing can target a named image profile', () => {
  const router=new ModelRouter([
    {id:'fast-image',provider:'nvidia',model:'fast-image',capabilities:['text-to-image'],maxConcurrent:1,enabled:true,priority:10,media:{kind:'image',endpoint:'https://example.test/fast'}},
    {id:'quality-image',provider:'nvidia',model:'quality-image',capabilities:['text-to-image'],maxConcurrent:1,enabled:true,priority:20,media:{kind:'image',endpoint:'https://example.test/quality'}}
  ]);
  assert.equal(router.get('quality-image')?.media?.endpoint,'https://example.test/quality');
});

test('worktree preparation skips npm ci when dependencies are already present', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'acp-worktree-'));
  const worktree=path.join(root,'worktree');
  fs.mkdirSync(path.join(worktree,'node_modules','typescript'),{recursive:true});
  try {
    const manager=new GitManager(root,path.join(root,'worktrees'));
    assert.equal(await manager.ensureDependencies(worktree),false);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('worktree synchronization fast-forwards only a clean worktree behind main', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'acp-git-'));
  const worktree=path.join(root,'task');
  const git=(args:string[],cwd=root)=>exec('git',args,{cwd});
  try {
    await git(['init','-b','main']);
    await git(['config','user.email','tests@example.test']);
    await git(['config','user.name','ACP tests']);
    fs.writeFileSync(path.join(root,'state.txt'),'one');
    await git(['add','state.txt']); await git(['commit','-m','initial']);
    await git(['worktree','add','-b','task',worktree,'main']);
    fs.writeFileSync(path.join(root,'state.txt'),'two');
    await git(['add','state.txt']); await git(['commit','-m','advance main']);
    const manager=new GitManager(root,path.join(root,'worktrees'));
    assert.equal(await manager.synchronize(worktree),true);
    assert.equal(fs.readFileSync(path.join(worktree,'state.txt'),'utf8'),'two');
    fs.writeFileSync(path.join(root,'state.txt'),'three');
    await git(['add','state.txt']); await git(['commit','-m','advance again']);
    fs.writeFileSync(path.join(worktree,'local.txt'),'preserve me');
    assert.equal(await manager.synchronize(worktree),false);
    assert.equal(fs.readFileSync(path.join(worktree,'state.txt'),'utf8'),'two');
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
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

test('NVIDIA image requests decode base64 output', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({artifacts:[{base64:Buffer.from('image-bytes').toString('base64'),mime_type:'image/png',seed:7}]}),{status:200});
  try {
    const result=await new NvidiaClient('https://example.test/v1','test-key').image('https://example.test/image','a small test image');
    assert.equal(result.bytes.toString(),'image-bytes'); assert.equal(result.mimeType,'image/png'); assert.equal(result.seed,7);
  } finally { globalThis.fetch=originalFetch; }
});

test('media service stores generated images as local artifacts', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'acp-media-'));
  const store=new (await import('../src/storage/db.js')).Store(path.join(root,'data'));
  const router=new ModelRouter([{id:'image',provider:'nvidia',model:'image-model',capabilities:['text-to-image'],maxConcurrent:1,enabled:true,media:{kind:'image',endpoint:'https://example.test/image'}}]);
  const client={image:async()=>({bytes:Buffer.from('image-bytes'),mimeType:'image/png',seed:42})};
  try {
    const media=new MediaService(router,client as any,store,path.join(root,'artifacts'),100);
    const result=await media.image('a test image');
    assert.equal(fs.readFileSync(result.path,'utf8'),'image-bytes');
    assert.equal(store.artifacts(result.jobId)[0].type,'media');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
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
