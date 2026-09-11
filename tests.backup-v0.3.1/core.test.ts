import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../src/models/router.js';
import { ContextRouter } from '../src/context/router.js';
import { TaskPlanner, readyNodes } from '../src/core/planner.js';

test('model routing is configurable and deduplicates candidates',()=>{const router=new ModelRouter([{id:'a',provider:'nvidia',model:'a',capabilities:['coding'],maxConcurrent:1,enabled:true},{id:'b',provider:'nvidia',model:'b',capabilities:['coding'],maxConcurrent:1,enabled:true}]);const candidates=router.candidates('builder',['b'],['a']);assert.equal(candidates[0].id,'b');assert.equal(new Set(candidates.map(x=>x.id)).size,candidates.length)});
test('context router returns task-scoped context instead of whole repository',()=>{const router=new ContextRouter(process.cwd());const pack=router.build({id:'TASK-9999',title:'test',objective:'test',type:'test',scope:{allowed:['src/core/**']},acceptance:['works'],review:{required:[]}});assert.equal(pack.task.id,'TASK-9999');assert.ok(pack.docs.some(x=>x.path==='AGENTS.md'));assert.ok(pack.files.length<=20);assert.ok(pack.tokenEstimate>0)});
test('planner creates resumable dependency graph',()=>{const nodes=new TaskPlanner().plan({id:'TASK-0001',title:'x',objective:'x',type:'test',scope:{allowed:['src/**']},acceptance:['x'],review:{required:['reviewer']},effort:'high'});assert.equal(nodes.length,4);assert.deepEqual(readyNodes(nodes,new Map(nodes.map(n=>[n.id,'pending']))).map(n=>n.role),['researcher']);});

test('learning loop creates bounded upgrade candidates and preserves lifecycle gates', async () => {
  const { Store } = await import('../src/storage/db.js');
  const { LearningLoop } = await import('../src/core/learning.js');
  const store = new Store('.data-test-upgrades');
  const loop = new LearningLoop(store);
  const finding = {id:'DUP-1',category:'duplicate' as const,severity:'medium' as const,source:'reviewer' as const,evidence:'same helper exists twice',rationale:'Duplicate abstraction found.',recommendation:'Reuse the existing helper.'};
  store.addFinding('TASK-0001', finding);
  const candidates = loop.proposeUpgrade('TASK-0001', 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, 'candidate');
  loop.approveUpgrade(candidates[0].id);
  loop.markUpgradeApplied(candidates[0].id);
  loop.markUpgradeValidated(candidates[0].id);
  assert.equal(loop.upgrades('validated')[0].status, 'validated');
});
