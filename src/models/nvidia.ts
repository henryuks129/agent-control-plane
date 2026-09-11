export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatUsage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
export interface ChatResult { text: string; usage: ChatUsage }
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
    if (!response.ok) {
      const retryable = [408, 409, 429, 500, 502, 503, 504].includes(response.status);
      const error = new Error(`NVIDIA API ${response.status}: ${text.slice(0, 1000)}`) as NvidiaRequestError;
      error.retryable = retryable;
      error.status = response.status;
      throw error;
    }
    const json = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }>; usage?: ChatUsage };
    return { text: json.choices?.[0]?.message?.content ?? '', usage: json.usage ?? {} };
  }
}
