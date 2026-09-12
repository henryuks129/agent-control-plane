import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ModelRouter } from '../src/models/router.js';
import { ContextRouter } from '../src/context/router.js';
import { TaskPlanner, readyNodes, resumeStatus, validateGraph } from '../src/core/planner.js';
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

test('model cooldown survives a new router and expires safely', () => {
  const profile={id:'image',provider:'nvidia',model:'image-model',capabilities:['text-to-image'],maxConcurrent:1,enabled:true,media:{kind:'image' as const,endpoint:'https://example.test/image'}};
  let saved: {id:string;health:'unknown'|'healthy'|'degraded'|'unavailable';reason?:string;checkedAt:string;cooldownUntil?:string}|undefined;
  const router=new ModelRouter([profile],[],60000,state=>{saved=state;});
  router.markHealth('image','degraded','request timed out');
  assert.deepEqual(router.mediaCandidates('text-to-image'),[]);
  assert.ok(saved?.cooldownUntil);
  assert.deepEqual(new ModelRouter([profile],[saved!]).mediaCandidates('text-to-image'),[]);
  const expired={...saved!,cooldownUntil:new Date(Date.now()-1).toISOString()};
  assert.deepEqual(new ModelRouter([profile],[expired]).mediaCandidates('text-to-image').map(item=>item.id),['image']);
});

test('model health cooldown is stored locally for the next CLI run', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'acp-model-health-'));
  const { Store }=await import('../src/storage/db.js');
  try {
    const store=new Store(root);
    store.saveModelHealth({id:'image',health:'degraded',reason:'request timed out',checkedAt:'2026-09-12T00:00:00.000Z',cooldownUntil:'2026-09-12T00:05:00.000Z'});
    assert.deepEqual(store.modelHealth(),[{id:'image',health:'degraded',reason:'request timed out',checkedAt:'2026-09-12T00:00:00.000Z',cooldownUntil:'2026-09-12T00:05:00.000Z'}]);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
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

test('patch validation requires a cleanly applicable patch within task scope', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'acp-patch-'));
  const git=(args:string[])=>exec('git',args,{cwd:root});
  try {
    await git(['init','-b','main']); await git(['config','user.email','tests@example.test']); await git(['config','user.name','ACP tests']);
    fs.mkdirSync(path.join(root,'src')); fs.writeFileSync(path.join(root,'src','example.ts'),'old\n');
    await git(['add','.']); await git(['commit','-m','initial']);
    const patchPath=path.join(root,'change.patch');
    fs.writeFileSync(patchPath,'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n');
    const manager=new GitManager(root,path.join(root,'worktrees'));
    assert.deepEqual(await manager.validatePatch(root,patchPath,['src/**']),{valid:true,files:['src/example.ts']});
    assert.equal((await manager.validatePatch(root,patchPath,['tests/**'])).valid,false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('patch lifecycle persists validation and approval records', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'acp-patch-state-'));
  const { Store }=await import('../src/storage/db.js');
  try {
    const store=new Store(root);
    store.savePatchLifecycle({artifactId:'TASK:patch',taskId:'TASK',worktree:'/tmp/task',status:'validated',validation:{valid:true,files:['src/example.ts']}});
    const validated=store.patchLifecycle('TASK:patch');
    assert.equal(validated?.status,'validated');
    store.savePatchLifecycle({...validated!,status:'approved',approvedAt:'2026-09-12T00:00:00.000Z'});
    assert.equal(store.patchLifecycle('TASK:patch')?.status,'approved');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
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

test('media service falls back to the next compatible image profile', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'acp-media-fallback-'));
  const store=new (await import('../src/storage/db.js')).Store(path.join(root,'data'));
  const router=new ModelRouter([
    {id:'primary',provider:'nvidia',model:'primary-model',capabilities:['text-to-image'],maxConcurrent:1,enabled:true,priority:10,media:{kind:'image',endpoint:'https://example.test/primary'}},
    {id:'fallback',provider:'nvidia',model:'fallback-model',capabilities:['text-to-image'],maxConcurrent:1,enabled:true,priority:20,media:{kind:'image',endpoint:'https://example.test/fallback'}}
  ]);
  const client={image:async(endpoint:string)=>{if(endpoint.endsWith('primary'))throw Object.assign(new Error('primary unavailable'),{retryable:true});return {bytes:Buffer.from('fallback-image'),mimeType:'image/png'};}};
  try {
    const media=new MediaService(router,client as any,store,path.join(root,'artifacts'),100);
    const result=await media.image('a test image');
    assert.equal(result.profile,'fallback');
    assert.equal(router.get('primary')?.health,'degraded');
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

test('resume status skips completed graph nodes and exposes the next node',()=>{
  const nodes=new TaskPlanner().plan({id:'TASK-RESUME',title:'resume',objective:'resume',type:'test',scope:{allowed:['src/**']},acceptance:['x'],review:{required:[]},effort:'medium'});
  const status=resumeStatus(nodes,nodeId=>nodeId==='TASK-RESUME-research'?{task_id:'TASK-RESUME',node_id:nodeId,phase:'researcher',completed:[],current:'done',changed:[],tests:{status:'passed'},blockers:[],next_action:'Build'}:undefined);
  assert.equal(status.get('TASK-RESUME-research'),'passed');
  assert.deepEqual(readyNodes(nodes,status).map(node=>node.id),['TASK-RESUME-build']);
});

test('custom task graphs reject unknown dependencies and cycles',()=>{
  const node=(id:string,dependsOn?:string[])=>({id,title:id,objective:id,role:'test' as const,dependsOn});
  assert.throws(()=>validateGraph([node('build',['missing'])]),/unknown node/);
  assert.throws(()=>validateGraph([node('a',['b']),node('b',['a'])]),/dependency cycle/);
  assert.doesNotThrow(()=>validateGraph([node('research'),node('build',['research']),node('test',['build'])]));
});

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
