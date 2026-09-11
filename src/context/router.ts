import fs from 'node:fs';
import path from 'node:path';
import type { Checkpoint, ContextPack, Task } from '../core/types.js';

function safeRead(root:string, relative:string):string|undefined { const abs=path.resolve(root,relative); const base=path.resolve(root)+path.sep; if(!abs.startsWith(base)&&abs!==path.resolve(root)) return; try{return fs.readFileSync(abs,'utf8')}catch{return} }
function walk(root:string, dir:string, maxFiles:number):string[] { const out:string[]=[]; const visit=(d:string)=>{if(out.length>=maxFiles)return; let entries:any[]=[]; try{entries=fs.readdirSync(d,{withFileTypes:true})}catch{return} for(const e of entries){if(['node_modules','.git','dist','.data','worktrees'].includes(e.name))continue; const abs=path.join(d,e.name); if(e.isDirectory())visit(abs); else if(/\.(ts|tsx|js|jsx|json|md|css|scss|yml|yaml)$/.test(e.name))out.push(path.relative(root,abs)); if(out.length>=maxFiles)return;}}; visit(path.resolve(root,dir)); return out; }

export class ContextRouter {
  constructor(private readonly root:string) {}
  build(task:Task, checkpoint?:Checkpoint, nodeScope?:string[]):ContextPack {
    const files:ContextPack['files']=[]; const docs:ContextPack['docs']=[]; const design:ContextPack['design']=[];
    const patterns=nodeScope?.length ? nodeScope : task.scope.allowed;
    for(const pattern of patterns){const base=pattern.replace(/\/\*\*.*$/,'').replace(/\/\*$/,'')||'.'; for(const file of walk(this.root,base,10)){if(files.some(x=>x.path===file))continue; const content=safeRead(this.root,file); if(content)files.push({path:file,reason:'task-scoped source',content:content.slice(0,12000)}); if(files.length>=20)break;}}
    for(const file of ['AGENTS.md','docs/protocols/task.md','docs/protocols/checkpoint.md','docs/protocols/review.md','docs/protocols/learning.md']){const content=safeRead(this.root,file);if(content)docs.push({path:file,reason:'control-plane rule',content:content.slice(0,7000)});}
    const approved=safeRead(this.root,'knowledge/lessons/README.md'); if(approved) docs.push({path:'knowledge/lessons/README.md',reason:'approved project learning index',content:approved.slice(0,4000)});
    for(const ref of task.design?.required??[]){for(const file of [`design-library/components/${ref}.md`,`design-library/patterns/${ref}.md`,`design-library/ux/${ref}.md`,`design-library/foundations/${ref}.md`,`design-library/anti-patterns/${ref}.md`]){const content=safeRead(this.root,file);if(content){design.push({path:file,reason:`design reference: ${ref}`,content:content.slice(0,9000)});break;}}}
    const tokenEstimate=Math.ceil([...files,...docs,...design].reduce((n,x)=>n+x.content.length,0)/4)+Math.ceil(JSON.stringify(task).length/4);
    return {task:{id:task.id,title:task.title,objective:task.objective,scope:task.scope,acceptance:task.acceptance},files,docs,design,checkpoint,tokenEstimate};
  }
}
