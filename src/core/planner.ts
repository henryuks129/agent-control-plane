import type { AgentRole, Checkpoint, Effort, Task, TaskNode } from './types.js';

export class TaskPlanner {
  plan(task: Task): TaskNode[] {
    if (task.execution?.nodes?.length) return task.execution.nodes;
    const effort: Effort = task.effort ?? 'medium';
    const nodes: TaskNode[] = [
      { id: `${task.id}-research`, title: 'Understand objective and constraints', objective: `Research and map the implementation constraints for: ${task.objective}`, role: 'researcher', effort: effort === 'low' ? 'low' : 'medium', scope: task.scope },
      { id: `${task.id}-build`, title: 'Implement the task', objective: task.objective, role: 'builder', dependsOn: [`${task.id}-research`], effort, scope: task.scope, acceptance: task.acceptance },
      { id: `${task.id}-test`, title: 'Run deterministic checks', objective: 'Run typecheck, tests and repository checks and report evidence.', role: 'test', dependsOn: [`${task.id}-build`], effort: 'low', scope: task.scope },
      { id: `${task.id}-review`, title: 'Review the implementation', objective: 'Review evidence for bugs, duplicate code, dead code, architecture, security and design drift.', role: 'reviewer', dependsOn: [`${task.id}-test`], effort: effort === 'maximum' ? 'high' : 'medium', scope: task.scope }
    ];
    if (task.execution?.strategy === 'parallel' || task.execution?.strategy === 'swarm') nodes[1].parallel = true;
    return nodes;
  }
}

export function readyNodes(nodes:TaskNode[], status:Map<string,string>):TaskNode[] { return nodes.filter(n => (status.get(n.id)??'pending')==='pending' && (n.dependsOn??[]).every(d => status.get(d)==='passed')); }
export function resumeStatus(nodes:TaskNode[],checkpointFor:(nodeId:string)=>Checkpoint|undefined) {
  const status=new Map<string,string>();
  for(const node of nodes) status.set(node.id,checkpointFor(node.id)?.tests.status==='passed'?'passed':'pending');
  return status;
}
export function roleForNode(node:TaskNode):AgentRole { return node.role; }
