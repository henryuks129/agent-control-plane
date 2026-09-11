export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatUsage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
export interface ChatResult { text: string; usage: ChatUsage }

export class NvidiaClient {
  constructor(private readonly baseUrl: string, private readonly apiKey?: string) {}

  async chat(model: string, messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {}): Promise<ChatResult> {
    if (!this.apiKey) throw new Error('NVIDIA_API_KEY is not configured');
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens ?? 4000 }),
      signal: opts.signal
    });
    const text = await response.text();
    if (!response.ok) {
      const retryable = [408, 409, 429, 500, 502, 503, 504].includes(response.status);
      const error = new Error(`NVIDIA API ${response.status}: ${text.slice(0, 1000)}`) as Error & { retryable?: boolean; status?: number };
      error.retryable = retryable;
      error.status = response.status;
      throw error;
    }
    const json = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }>; usage?: ChatUsage };
    return { text: json.choices?.[0]?.message?.content ?? '', usage: json.usage ?? {} };
  }
}
