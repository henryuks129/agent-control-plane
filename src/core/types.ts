export type AgentRole = 'planner' | 'builder' | 'reviewer' | 'researcher' | 'test' | 'recovery';
export type TaskStatus = 'queued' | 'planning' | 'assigned' | 'running' | 'checkpointed' | 'review' | 'passed' | 'failed' | 'merged' | 'blocked';
export type Effort = 'low' | 'medium' | 'high' | 'maximum';
export type NodeStatus = 'pending' | 'running' | 'checkpointed' | 'passed' | 'failed' | 'blocked';
export type ModelHealth = 'unknown' | 'healthy' | 'degraded' | 'unavailable';

export interface ProjectProfile {
  id: string;
  name: string;
  root: string;
  defaultBranch: string;
  dataDir: string;
  artifactsDir: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettings {
  version: 1;
  profiles?: Record<string,{enabled?:boolean;priority?:number;maxConcurrent?:number}>;
  rolePreferences?: Partial<Record<AgentRole,{primary?:string[];fallback?:string[]}>>;
  budgets?: Partial<Record<Effort,Partial<Budget>>>;
  timeouts?: { requestTimeoutMs?:number; reviewerTimeoutMs?:number; researcherTimeoutMs?:number; builderTimeoutMs?:number };
}

export interface Budget {
  maxTokens: number;
  maxRequests: number;
  maxDurationMinutes: number;
  maxAgents: number;
}

export interface TaskNode {
  id: string;
  title: string;
  objective: string;
  role: AgentRole;
  dependsOn?: string[];
  parallel?: boolean;
  effort?: Effort;
  budget?: Partial<Budget>;
  scope?: { allowed: string[] };
  acceptance?: string[];
}

export interface Task {
  id: string;
  projectId?: string;
  title: string;
  objective: string;
  type: string;
  priority?: string;
  scope: { allowed: string[] };
  acceptance: string[];
  review: { required: string[] };
  dependencies?: string[];
  design?: { required?: string[] };
  architecture?: { required?: string[] };
  model_preferences?: { primary?: string[]; fallback?: string[] };
  effort?: Effort;
  budget?: Partial<Budget>;
  execution?: { strategy?: 'sequential' | 'parallel' | 'swarm'; nodes?: TaskNode[]; maxConcurrency?: number };
}

export interface Checkpoint {
  task_id: string;
  node_id?: string;
  phase: string;
  completed: string[];
  current: string;
  changed: string[];
  tests: { status: 'pending' | 'running' | 'passed' | 'failed'; summary?: string };
  blockers: string[];
  next_action: string;
  usage?: { inputTokens?: number; outputTokens?: number; requests?: number };
}

export interface ContextPack {
  task: Pick<Task, 'id' | 'title' | 'objective' | 'scope' | 'acceptance'>;
  files: Array<{ path: string; reason: string; content: string }>;
  docs: Array<{ path: string; reason: string; content: string }>;
  design: Array<{ path: string; reason: string; content: string }>;
  checkpoint?: Checkpoint;
  tokenEstimate: number;
}

export interface ModelProfile {
  id: string;
  provider: string;
  model: string;
  capabilities: string[];
  maxConcurrent: number;
  enabled: boolean;
  health?: ModelHealth;
  contextWindow?: number;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
  reasoningBudgets?: Partial<Record<Effort, number>>;
  priority?: number;
  lastCheckedAt?: string;
  unavailableReason?: string;
  media?: { kind: 'image'; endpoint: string; mimeType?: string };
}

export interface ReviewFinding {
  id: string;
  category: 'bug' | 'duplicate' | 'dead-code' | 'architecture' | 'design' | 'security' | 'performance' | 'testing' | 'other';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  source: 'fallow' | 'tests' | 'reviewer' | 'coderabbit' | 'human';
  evidence: string;
  location?: string;
  rationale: string;
  recommendation: string;
}

export interface Artifact {
  id: string;
  taskId: string;
  type: 'checkpoint' | 'research' | 'review' | 'patch' | 'report' | 'design-candidate' | 'media' | 'other';
  path: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRun {
  id: string;
  taskId: string;
  nodeId: string;
  role: AgentRole;
  modelId: string;
  status: 'running' | 'passed' | 'failed' | 'recovered';
  inputTokens?: number;
  outputTokens?: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export type UpgradeStatus = 'candidate' | 'approved' | 'applied' | 'validated' | 'rejected' | 'rolled_back';

export interface UpgradeIteration {
  id: number;
  parentId?: number;
  source: string;
  target: 'routing' | 'context' | 'budget' | 'prompt' | 'review' | 'design' | 'safety' | 'other';
  hypothesis: string;
  change: string;
  evidence: string[];
  status: UpgradeStatus;
  createdAt: string;
  validatedAt?: string;
}

export interface LearningIteration {
  id: number;
  taskId: string;
  source: string;
  summary: string;
  candidateRule?: string;
  approved: boolean;
  createdAt: string;
}
