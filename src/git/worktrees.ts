import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const exec=promisify(execFile);
export interface PreparedWorktree { path:string; dependenciesInstalled:boolean; }
export class GitManager {
  constructor(private readonly root:string,private readonly worktreeDir:string){}
  async ensureWorktree(taskId:string){const safe=taskId.replace(/[^A-Za-z0-9_-]/g,'-');const target=path.resolve(this.worktreeDir,safe);fs.mkdirSync(this.worktreeDir,{recursive:true});if(!fs.existsSync(path.join(target,'.git'))){await exec('git',['worktree','add','-b',`acp/${safe}`,target,'HEAD'],{cwd:this.root});}return target;}
  async ensureDependencies(worktree:string){
    if(fs.existsSync(path.join(worktree,'node_modules','typescript'))) return false;
    await exec('npm',['ci','--ignore-scripts'],{cwd:worktree,maxBuffer:1024*1024});
    return true;
  }
  async prepareWorktree(taskId:string):Promise<PreparedWorktree>{
    const path=await this.ensureWorktree(taskId);
    return {path,dependenciesInstalled:await this.ensureDependencies(path)};
  }
  async diff(worktree:string){return (await exec('git',['diff','--no-ext-diff'],{cwd:worktree})).stdout;}
  async status(worktree:string){return (await exec('git',['status','--short'],{cwd:worktree})).stdout;}
  async applyPatch(worktree:string,patchPath:string){return exec('git',['apply','--3way',patchPath],{cwd:worktree});}
}
