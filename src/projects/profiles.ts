import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ProjectProfile } from '../core/types.js';
import { LOCAL_ORGANIZATION_ID, Store } from '../storage/db.js';

const exec=promisify(execFile);

export class ProjectRegistry {
  constructor(private readonly store:Store) {}
  private async git(cwd:string,args:string[]) {
    try { return (await exec('git',args,{cwd,maxBuffer:1024*1024})).stdout.trim(); }
    catch(error) { const failure=error as {stderr?:string;message?:string}; throw new Error(`Repository onboarding failed: ${(failure.stderr||failure.message||'Git could not inspect this path.').trim()}`); }
  }
  async onboard(input:string,organizationId=LOCAL_ORGANIZATION_ID):Promise<ProjectProfile> {
    const requested=path.resolve(input);
    if(!fs.existsSync(requested)||!fs.statSync(requested).isDirectory()) throw new Error(`Repository path does not exist or is not a directory: ${requested}`);
    const root=fs.realpathSync(await this.git(requested,['rev-parse','--show-toplevel']));
    const defaultBranch=await this.git(root,['branch','--show-current']);
    if(!defaultBranch) throw new Error('Repository onboarding requires a checked-out branch; detached HEAD is not supported.');
    const now=new Date().toISOString(); const existing=this.store.projectByRoot(root);
    const profile:ProjectProfile={id:existing?.id??`PROJECT-${crypto.randomUUID()}`,organizationId:existing?.organizationId??organizationId,name:path.basename(root),root,defaultBranch,dataDir:path.join(root,'.data'),artifactsDir:path.join(root,'.data','artifacts'),createdAt:existing?.createdAt??now,updatedAt:now};
    this.store.saveProject(profile); return this.store.projectByRoot(root)!;
  }
  list(){return this.store.projects();}
  show(id:string){return this.store.project(id);}
}
