import { NvidiaClient } from '../models/nvidia.js';
import type { ContextPack, ReviewFinding } from '../core/types.js';

export function parseReviewFindings(raw:string):ReviewFinding[]|undefined {
  const candidates=[raw.trim(),...Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi),match=>match[1].trim())];
  for(const candidate of candidates) {
    try { const parsed=JSON.parse(candidate) as {findings?:ReviewFinding[]}; if(Array.isArray(parsed.findings)) return parsed.findings; } catch { /* try the next representation */ }
    const marker=candidate.lastIndexOf('"findings"');
    const start=marker<0?-1:candidate.lastIndexOf('{',marker);
    if(start<0) continue;
    let depth=0,quoted=false,escaped=false;
    for(let index=start;index<candidate.length;index++) {
      const char=candidate[index];
      if(quoted) { if(!escaped&&char==='"') quoted=false; escaped=!escaped&&char==='\\'; continue; }
      if(char==='"') { quoted=true; continue; }
      if(char==='{') depth++;
      if(char==='}'&&--depth===0) { try { const parsed=JSON.parse(candidate.slice(start,index+1)) as {findings?:ReviewFinding[]}; if(Array.isArray(parsed.findings)) return parsed.findings; } catch { break; } }
    }
  }
  return undefined;
}

export class LlmReviewer {
  constructor(private readonly client:NvidiaClient,private readonly model:string,private readonly timeoutMs=90000){}
  async review(context:ContextPack,evidence:unknown):Promise<ReviewFinding[]>{
    const files=context.files.slice(0,3).map(f=>`--- ${f.path}\n${f.content.slice(0,2500)}`).join('\n');
    const design=context.design.slice(0,1).map(f=>`--- ${f.path}\n${f.content.slice(0,1500)}`).join('\n');
    const prompt=['Review the implementation using evidence first. Report only material, evidence-backed issues. Return at most five findings as exactly one JSON object in the form {"findings":[...]}; no prose, markdown, or reasoning. If no material issue is supported, return {"findings":[]}.',JSON.stringify({task:context.task,checkpoint:context.checkpoint,evidence}),`FILES:\n${files}`,`DESIGN:\n${design}`].join('\n\n');
    const result=await this.client.chat(this.model,[{role:'system',content:'You are a strict ACP software reviewer. Output exactly one JSON object and no other text.'},{role:'user',content:prompt}],{temperature:0,maxTokens:500,timeoutMs:this.timeoutMs});
    return parseReviewFindings(result.text)??[{id:'REVIEW-PARSE',category:'other',severity:'high',source:'reviewer',evidence:result.text.slice(0,5000),rationale:'Reviewer did not return a parseable JSON finding set.',recommendation:'Retry the review with structured JSON output.'}];
  }
}
