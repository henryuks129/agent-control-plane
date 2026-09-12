import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const exec=promisify(execFile);
export interface PreparedWorktree { path:string; dependenciesInstalled:boolean; synchronized:boolean; }
export interface PatchValidation { valid:boolean; files:string[]; reason?:string; }

function patchFiles(patch:string) {
  const files:string[]=[];
  for(const line of patch.split(/\r?\n/)) {
    const match=line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if(!match) continue;
    for(const file of [match[1],match[2]]) if(file!=='/dev/null'&&!files.includes(file)) files.push(file);
  }
  return files;
}

function scopeAllows(file:string,allowed:string[]) {
  if(file.startsWith('/')||file.split('/').includes('..')) return false;
  return allowed.some(rule=>rule.endsWith('/**')?file.startsWith(rule.slice(0,-3)):file===rule);
}
export class GitManager {
  constructor(private readonly root:string,private readonly worktreeDir:string){}
  async ensureWorktree(taskId:string){const safe=taskId.replace(/[^A-Za-z0-9_-]/g,'-');const target=path.resolve(this.worktreeDir,safe);fs.mkdirSync(this.worktreeDir,{recursive:true});if(!fs.existsSync(path.join(target,'.git'))){await exec('git',['worktree','add','-b',`acp/${safe}`,target,'HEAD'],{cwd:this.root});}return target;}
  async ensureDependencies(worktree:string){
    if(fs.existsSync(path.join(worktree,'node_modules','typescript'))) return false;
    await exec('npm',['ci','--ignore-scripts'],{cwd:worktree,maxBuffer:1024*1024});
    return true;
  }
  async synchronize(worktree:string){
    const status=await this.status(worktree);
    if(status.trim()) return false;
    const counts=(await exec('git',['rev-list','--left-right','--count','HEAD...main'],{cwd:worktree})).stdout.trim().split(/\s+/).map(Number);
    const [ahead,behind]=counts;
    if(ahead!==0||behind===0) return false;
    await exec('git',['merge','--ff-only','main'],{cwd:worktree});
    return true;
  }
  async prepareWorktree(taskId:string):Promise<PreparedWorktree>{
    const path=await this.ensureWorktree(taskId);
    const synchronized=await this.synchronize(path);
    return {path,dependenciesInstalled:await this.ensureDependencies(path),synchronized};
  }
  async diff(worktree:string){return (await exec('git',['diff','--no-ext-diff'],{cwd:worktree})).stdout;}
  async status(worktree:string){return (await exec('git',['status','--short'],{cwd:worktree})).stdout;}
  async validatePatch(worktree:string,patchPath:string,allowed:string[]):Promise<PatchValidation>{
    const files=patchFiles(fs.readFileSync(patchPath,'utf8'));
    if(!files.length) return {valid:false,files,reason:'Patch has no supported file headers.'};
    const outside=files.filter(file=>!scopeAllows(file,allowed));
    if(outside.length) return {valid:false,files,reason:`Patch changes files outside task scope: ${outside.join(', ')}`};
    try { await exec('git',['apply','--check',patchPath],{cwd:worktree}); return {valid:true,files}; }
    catch(error) { const failure=error as {stderr?:string;stdout?:string;message?:string}; return {valid:false,files,reason:(failure.stderr||failure.stdout||failure.message||'Patch cannot be applied cleanly.').trim()}; }
  }
  async applyPatch(worktree:string,patchPath:string){return exec('git',['apply','--3way',patchPath],{cwd:worktree});}
}
