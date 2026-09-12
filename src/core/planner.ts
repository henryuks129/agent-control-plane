import type { AgentRole, Checkpoint, Effort, Task, TaskNode } from './types.js';

export class TaskPlanner {
  plan(task: Task): TaskNode[] {
    if (task.execution?.nodes?.length) { validateGraph(task.execution.nodes); return task.execution.nodes; }
    const effort: Effort = task.effort ?? 'medium';
    const nodes: TaskNode[] = [
      { id: `${task.id}-research`, title: 'Understand objective and constraints', objective: `Research and map the implementation constraints for: ${task.objective}`, role: 'researcher', effort: effort === 'low' ? 'low' : 'medium', scope: task.scope },
      { id: `${task.id}-build`, title: 'Implement the task', objective: task.objective, role: 'builder', dependsOn: [`${task.id}-research`], effort, scope: task.scope, acceptance: task.acceptance },
      { id: `${task.id}-test`, title: 'Run deterministic checks', objective: 'Run typecheck, tests and repository checks and report evidence.', role: 'test', dependsOn: [`${task.id}-build`], effort: 'low', scope: task.scope },
      { id: `${task.id}-review`, title: 'Review the implementation', objective: 'Review evidence for bugs, duplicate code, dead code, architecture, security and design drift.', role: 'reviewer', dependsOn: [`${task.id}-test`], effort: effort === 'maximum' ? 'high' : 'medium', scope: task.scope }
    ];
    if (task.execution?.strategy === 'parallel' || task.execution?.strategy === 'swarm') nodes[1].parallel = true;
    validateGraph(nodes); return nodes;
  }
}

export function readyNodes(nodes:TaskNode[], status:Map<string,string>):TaskNode[] { return nodes.filter(n => (status.get(n.id)??'pending')==='pending' && (n.dependsOn??[]).every(d => status.get(d)==='passed')); }
export function validateGraph(nodes:TaskNode[]) {
  const ids=new Set<string>();
  for(const node of nodes) { if(ids.has(node.id)) throw new Error(`Task graph has duplicate node id: ${node.id}`); ids.add(node.id); }
  for(const node of nodes) for(const dependency of node.dependsOn??[]) {
    if(!ids.has(dependency)) throw new Error(`Task graph node ${node.id} depends on unknown node: ${dependency}`);
    if(dependency===node.id) throw new Error(`Task graph node ${node.id} cannot depend on itself`);
  }
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(id:string):void=>{ if(visited.has(id)) return; if(visiting.has(id)) throw new Error(`Task graph has a dependency cycle at: ${id}`); visiting.add(id); const node=nodes.find(item=>item.id===id)!; for(const dependency of node.dependsOn??[]) visit(dependency); visiting.delete(id); visited.add(id); };
  for(const node of nodes) visit(node.id);
}
export function resumeStatus(nodes:TaskNode[],checkpointFor:(nodeId:string)=>Checkpoint|undefined) {
  const status=new Map<string,string>();
  for(const node of nodes) status.set(node.id,checkpointFor(node.id)?.tests.status==='passed'?'passed':'pending');
  return status;
}
export function roleForNode(node:TaskNode):AgentRole { return node.role; }
