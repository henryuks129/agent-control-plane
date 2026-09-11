import { NvidiaClient } from '../models/nvidia.js';
import type { ContextPack, ReviewFinding } from '../core/types.js';

export class LlmReviewer {
  constructor(private readonly client:NvidiaClient,private readonly model:string){}
  async review(context:ContextPack,evidence:unknown):Promise<ReviewFinding[]>{
    const prompt=['Review the implementation using evidence first. Do not invent repository facts. Identify duplicate abstractions, dead code, architecture violations, security issues, missing tests, and design drift. Return JSON only.',JSON.stringify({task:context.task,checkpoint:context.checkpoint,evidence}),`FILES:\n${context.files.map(f=>`--- ${f.path}\n${f.content}`).join('\n')}`,`DESIGN:\n${context.design.map(f=>`--- ${f.path}\n${f.content}`).join('\n')}`].join('\n\n');
    const result=await this.client.chat(this.model,[{role:'system',content:'You are a strict ACP software reviewer.'},{role:'user',content:prompt}],{temperature:0.1,maxTokens:6000});
    try{return (JSON.parse(result.text) as {findings?:ReviewFinding[]}).findings??[]}catch{return [{id:'REVIEW-PARSE',category:'other',severity:'medium',source:'reviewer',evidence:result.text.slice(0,5000),rationale:'Reviewer did not return valid structured JSON.',recommendation:'Retry the review with structured JSON output.'}]}
  }
}
