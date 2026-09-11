import type { AgentRole, ModelProfile } from '../core/types.js';

export class ModelRouter {
  private profiles: ModelProfile[];
  constructor(profiles: ModelProfile[]) { this.profiles = profiles.filter(p => p.enabled); }

  candidates(role: AgentRole, preferred: string[] = [], fallback: string[] = []): ModelProfile[] {
    const roleHint = role === 'builder' || role === 'recovery' ? ['coding', 'reasoning'] : role === 'reviewer' ? ['review', 'reasoning'] : role === 'researcher' ? ['research', 'reasoning'] : ['reasoning'];
    const byId = (id: string) => this.profiles.find(p => p.id === id);
    const selected = [...preferred, ...fallback].map(byId).filter((x): x is ModelProfile => !!x);
    const capable = this.profiles.filter(p => roleHint.some(c => p.capabilities.includes(c)));
    return [...new Map([...selected, ...capable].map(p => [p.id, p])).values()];
  }

  get(id: string) { return this.profiles.find(p => p.id === id); }
  all() { return [...this.profiles]; }
}

export class ConcurrencyManager {
  private active = new Map<string, number>();
  constructor(private readonly globalMax: number) {}

  private total() { return [...this.active.values()].reduce((a, b) => a + b, 0); }
  async acquire(profile: ModelProfile, signal?: AbortSignal): Promise<() => void> {
    while (this.total() >= this.globalMax || (this.active.get(profile.id) ?? 0) >= profile.maxConcurrent) {
      if (signal?.aborted) throw new Error('Concurrency wait aborted');
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
    this.active.set(profile.id, (this.active.get(profile.id) ?? 0) + 1);
    return () => this.release(profile.id);
  }

  private release(id: string) {
    const n = (this.active.get(id) ?? 1) - 1;
    if (n <= 0) this.active.delete(id); else this.active.set(id, n);
  }
}
