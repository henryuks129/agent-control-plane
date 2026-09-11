import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ModelRouter } from '../models/router.js';
import { NvidiaClient } from '../models/nvidia.js';
import { Store } from '../storage/db.js';

interface MediaJob { jobId:string; profile:string; model:string; path:string; mimeType:string; seed?:number }

export class MediaService {
  constructor(private readonly router:ModelRouter,private readonly nvidia:NvidiaClient,private readonly store:Store,private readonly artifactsDir:string,private readonly timeoutMs:number) {}
  models(){return this.router.mediaCandidates('text-to-image',true);}
  async image(prompt:string,preferredId?:string){
    return this.tryCandidates(this.candidates(preferredId),prompt);
  }
  private candidates(preferredId?:string) {
    if(!preferredId) return this.router.mediaCandidates('text-to-image');
    const profile=this.router.get(preferredId);
    if(!profile) throw new Error(`Unknown text-to-image profile: ${preferredId}`);
    if(!profile.media) throw new Error(`Unknown text-to-image profile: ${preferredId}`);
    if(!profile.capabilities.includes('text-to-image')) throw new Error(`Unknown text-to-image profile: ${preferredId}`);
    return [profile];
  }
  private async tryCandidates(candidates:ReturnType<ModelRouter['mediaCandidates']>,prompt:string,failures:string[]=[]):Promise<MediaJob> {
    const [profile,...remaining]=candidates;
    if(!profile) throw new Error(`All configured NVIDIA image models failed\n${failures.join('\n')}`);
    try { return await this.generate(profile,prompt); }
    catch(error) {
      const message=error instanceof Error?error.message:String(error);
      this.router.markHealth(profile.id,'degraded',message);
      return this.tryCandidates(remaining,prompt,[...failures,`${profile.id}: ${message}`]);
    }
  }
  private async generate(profile:ReturnType<ModelRouter['get']>,prompt:string):Promise<MediaJob> {
    if(!profile?.media) throw new Error('Image profile is missing media endpoint configuration');
    const result=await this.nvidia.image(profile.media.endpoint,prompt,{timeoutMs:this.timeoutMs});
    this.router.markHealth(profile.id,'healthy');
    return this.persist(profile.id,profile.model,prompt,result);
  }
  private persist(profile:string,model:string,prompt:string,result:{bytes:Buffer;mimeType:string;seed?:number}):MediaJob {
    const jobId=`MEDIA-${randomUUID()}`;
    const extension=result.mimeType==='image/jpeg'?'jpg':'png';
    const directory=path.join(this.artifactsDir,'media',jobId);
    const output=path.join(directory,`image.${extension}`);
    fs.mkdirSync(directory,{recursive:true}); fs.writeFileSync(output,result.bytes);
    this.store.addArtifact({id:jobId,taskId:jobId,type:'media',path:output,metadata:{capability:'text-to-image',profile,model,prompt,seed:result.seed,mimeType:result.mimeType}});
    return {jobId,profile,model,path:output,mimeType:result.mimeType,seed:result.seed};
  }
}
