import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
export interface EvidenceResult {tool:string;ok:boolean;exitCode:number;stdout:string;stderr:string;}
export async function runCommand(command:string,cwd:string):Promise<EvidenceResult>{const parts=command.match(/(?:[^\s"]+|"[^"]*")+/g)??[];const [bin,...args]=parts.map(x=>x.replace(/^"|"$/g,''));try{const r=await exec(bin,args,{cwd,maxBuffer:8*1024*1024});return {tool:command,ok:true,exitCode:0,stdout:r.stdout,stderr:r.stderr};}catch(err){const e=err as {code?:number;stdout?:string;stderr?:string};return {tool:command,ok:false,exitCode:Number(e.code??1),stdout:e.stdout??'',stderr:e.stderr??''};}}
