export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatUsage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
export interface ChatResult { text: string; usage: ChatUsage }
export interface ImageResult { bytes: Buffer; mimeType: string; seed?: number }
export interface ChatOptions { temperature?: number; maxTokens?: number; signal?: AbortSignal; timeoutMs?: number; effort?: 'low' | 'medium' | 'high' | 'maximum' }

export type NvidiaRequestError = Error & { retryable?: boolean; status?: number };

function retryableTransportError(error: unknown): NvidiaRequestError {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const causeText = cause instanceof Error ? cause.message : cause ? String(cause) : '';
  const requestError = new Error(`NVIDIA transport error: ${message}${causeText ? ` (${causeText})` : ''}`) as NvidiaRequestError;
  // A failed fetch has no HTTP response, so it is transient by default. The
  // runtime can retry it and then continue to the next configured profile.
  requestError.retryable = true;
  return requestError;
}

function apiError(status:number,text:string):NvidiaRequestError {
  return Object.assign(new Error(`NVIDIA API ${status}: ${text.slice(0,1000)}`),{retryable:[408,409,429,500,502,503,504].includes(status),status}) as NvidiaRequestError;
}

type ImagePayload={artifacts?:Array<{base64?:string;mime_type?:string;seed?:number}>;image?:string;base64?:string;seed?:number};

function imageData(json:ImagePayload):string {
  const artifact=json.artifacts?.[0];
  if(artifact?.base64) return artifact.base64;
  if(json.base64) return json.base64;
  if(json.image) return json.image;
  throw new Error('NVIDIA image response did not contain base64 image data');
}

function decodeImage(text:string):ImageResult {
  const json=JSON.parse(text) as ImagePayload;
  const artifact=json.artifacts?.[0];
  const encoded=imageData(json);
  const bytes=Buffer.from(encoded.replace(/^data:image\/[^;]+;base64,/,''),'base64');
  if(!bytes.length) throw new Error('NVIDIA image response contained empty image data');
  return {bytes,mimeType:artifact?.mime_type??'image/png',seed:artifact?.seed??json.seed};
}

function imageBody(prompt:string,opts:{width?:number;height?:number;seed?:number}) {
  return {prompt,width:opts.width??1024,height:opts.height??1024,samples:1,seed:opts.seed??0,steps:4};
}

export class NvidiaClient {
  constructor(private readonly baseUrl: string, private readonly apiKey?: string, private readonly requestTimeoutMs=45000) {}

  async chat(model: string, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    if (!this.apiKey) throw new Error('NVIDIA_API_KEY is not configured');
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 4000
    };
    const timeoutMs=opts.timeoutMs??this.requestTimeoutMs;
    const controller=new AbortController();
    const abortFromCaller=()=>controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener('abort',abortFromCaller,{once:true});
    const timer=setTimeout(()=>controller.abort(new Error(`NVIDIA request timed out after ${timeoutMs}ms`)),timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      text = await response.text();
    } catch (error) {
      throw retryableTransportError(error);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort',abortFromCaller);
    }
    if (!response.ok) throw apiError(response.status,text);
    const json = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }>; usage?: ChatUsage };
    return { text: json.choices?.[0]?.message?.content ?? '', usage: json.usage ?? {} };
  }

  async image(endpoint:string,prompt:string,opts:{width?:number;height?:number;seed?:number;timeoutMs?:number}={}):Promise<ImageResult> {
    if(!this.apiKey) throw new Error('NVIDIA_API_KEY is not configured');
    if(!prompt.trim()) throw new Error('An image prompt is required');
    if(prompt.length>10000) throw new Error('Image prompt exceeds NVIDIA\'s 10000-character limit');
    const timeoutMs=opts.timeoutMs??this.requestTimeoutMs;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(new Error(`NVIDIA image request timed out after ${timeoutMs}ms`)),timeoutMs);
    let response:Response; let text:string;
    try {
      response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(imageBody(prompt,opts)),signal:controller.signal});
      text=await response.text();
    } catch(error) { throw retryableTransportError(error); } finally { clearTimeout(timer); }
    if(!response.ok) throw apiError(response.status,text);
    return decodeImage(text);
  }
}
