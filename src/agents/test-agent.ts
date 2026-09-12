import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Task, TaskNode } from '../core/types.js';
import { Store } from '../storage/db.js';

const exec=promisify(execFile);
export interface TestAgentResult { ok:boolean; summary:string; usage:{inputTokens:number;outputTokens:number;requests:number}; commands:string[]; }

export class DeterministicTestAgent {
  constructor(private readonly root:string,private readonly store:Store,private readonly artifactsDir:string) {}
  async execute(task:Task,node:TaskNode):Promise<TestAgentResult> {
    const run={id:crypto.randomUUID(),taskId:task.id,nodeId:node.id,role:node.role,modelId:'deterministic-test',status:'running' as const,startedAt:new Date().toISOString()};
    this.store.addAgentRun(run);
    const commands=['typecheck','build','test']; const evidence:string[]=[];
    try {
      for(const command of commands) {
        const result=await exec('npm',['run',command],{cwd:this.root,maxBuffer:8*1024*1024});
        evidence.push(`## npm run ${command}\n\n${result.stdout}${result.stderr}`);
      }
      const artifactBase=path.join(this.artifactsDir,task.id); fs.mkdirSync(artifactBase,{recursive:true});
      const output=path.join(artifactBase,`${node.id}.md`); fs.writeFileSync(output,evidence.join('\n'));
      this.store.addArtifact({id:`${task.id}:${node.id}:response`,taskId:task.id,type:'report',path:output,metadata:{runner:'deterministic-test',commands}});
      this.store.updateAgentRun({...run,status:'passed',finishedAt:new Date().toISOString()});
      return {ok:true,summary:'Dedicated test agent passed typecheck, build, and tests.',usage:{inputTokens:0,outputTokens:0,requests:0},commands};
    } catch(error) {
      const failure=error as {stdout?:string;stderr?:string;message?:string}; const summary=`Dedicated test agent failed: ${failure.stderr||failure.stdout||failure.message||String(error)}`;
      this.store.updateAgentRun({...run,status:'failed',finishedAt:new Date().toISOString(),error:summary});
      return {ok:false,summary,usage:{inputTokens:0,outputTokens:0,requests:0},commands};
    }
  }
}
