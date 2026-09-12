import type { AgentRole, Effort, ModelHealth, ModelProfile } from '../core/types.js';

export interface StoredModelHealth { id:string; health:ModelHealth; reason?:string; checkedAt:string; cooldownUntil?:string }

const ROLE_CAPABILITIES: Record<AgentRole, string[]> = {
  planner: ['planning', 'reasoning'],
  builder: ['coding', 'reasoning'],
  reviewer: ['review', 'reasoning', 'coding'],
  researcher: ['research', 'reasoning'],
  test: ['coding', 'testing'],
  recovery: ['recovery', 'coding', 'reasoning']
};

export interface RouteRequirements {
  role: AgentRole;
  effort?: Effort;
  preferred?: string[];
  fallback?: string[];
  requiredCapabilities?: string[];
  allowDegraded?: boolean;
}

export class ModelRouter {
  private profiles: ModelProfile[];
  private readonly saved=new Map<string,StoredModelHealth>();

  constructor(profiles: ModelProfile[],health:StoredModelHealth[]=[],private readonly cooldownMs=300000,private readonly persist?:(state:StoredModelHealth)=>void) {
    for(const state of health) this.saved.set(state.id,state);
    this.profiles = profiles.map(p => this.restore(p));
  }
  private restore(profile:ModelProfile):ModelProfile {
    const state=this.saved.get(profile.id);
    if(!state) return {health:'unknown',...profile};
    if(state.health==='degraded'&&(!state.cooldownUntil||Date.parse(state.cooldownUntil)<=Date.now())) return {health:'unknown',...profile};
    return {...profile,health:state.health,lastCheckedAt:state.checkedAt,unavailableReason:state.reason};
  }

  candidates(role: AgentRole, preferred: string[] = [], fallback: string[] = [], effort: Effort = 'medium'): ModelProfile[] {
    return this.route({ role, preferred, fallback, effort });
  }

  route(req: RouteRequirements): ModelProfile[] {
    const hints = [...(ROLE_CAPABILITIES[req.role] ?? []), ...(req.requiredCapabilities ?? [])];
    const ids = [...(req.preferred ?? []), ...(req.fallback ?? [])];
    const byId = (id: string) => this.profiles.find(p => p.id === id || p.model === id);
    const explicit = ids.map(byId).filter((x): x is ModelProfile => !!x);
    const capable = this.profiles.filter(p => {
      if (!p.enabled) return false;
      if (p.health === 'unavailable') return false;
      if (p.health === 'degraded' && !req.allowDegraded) return false;
      return hints.some(c => p.capabilities.includes(c));
    });
    const healthyExplicit = explicit.filter(p => p.enabled && p.health !== 'unavailable');
    const relevance = (profile: ModelProfile) =>
      (profile.id === req.role ? 100 : 0) + hints.filter(capability => profile.capabilities.includes(capability)).length;
    const rankedCapable = capable.sort((a, b) => relevance(b) - relevance(a) || (a.priority ?? 100) - (b.priority ?? 100));
    const seen = new Set<string>();
    return [...healthyExplicit, ...rankedCapable].filter(profile => {
      const key = `${profile.provider}:${profile.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  get(id: string) { return this.profiles.find(p => p.id === id || p.model === id); }
  all() { return [...this.profiles]; }
  private supportsMedia(profile:ModelProfile,capability:string) {
    return profile.enabled&&Boolean(profile.media)&&profile.capabilities.includes(capability);
  }
  private acceptsHealth(profile:ModelProfile,allowDegraded:boolean) {
    if(profile.health==='unavailable') return false;
    if(profile.health==='degraded') return allowDegraded;
    return true;
  }
  private mediaEligible(profile:ModelProfile,capability:string,allowDegraded:boolean) {
    return this.supportsMedia(profile,capability)&&this.acceptsHealth(profile,allowDegraded);
  }
  private uniqueMedia(profile:ModelProfile,seen:Set<string>) {
    const key=`${profile.provider}:${profile.model}`;
    if(seen.has(key)) return false;
    seen.add(key); return true;
  }
  mediaCandidates(capability: string, allowDegraded=false) {
    const seen=new Set<string>();
    return this.profiles
      .filter(p=>this.mediaEligible(p,capability,allowDegraded))
      .sort((a,b)=>(a.priority??100)-(b.priority??100))
      .filter(p=>this.uniqueMedia(p,seen));
  }

  markHealth(id: string, health: ModelHealth, reason?: string) {
    const profile = this.get(id);
    if (!profile) throw new Error(`Unknown model profile: ${id}`);
    const checkedAt=new Date().toISOString();
    const cooldownUntil=health==='degraded'?new Date(Date.now()+this.cooldownMs).toISOString():undefined;
    profile.health = health;
    profile.lastCheckedAt = checkedAt;
    profile.unavailableReason = reason;
    const state={id,health,reason,checkedAt,cooldownUntil};
    this.saved.set(id,state);
    this.persist?.(state);
  }
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
