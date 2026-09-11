import fs from 'node:fs';
import path from 'node:path';
import type { Budget, ModelProfile } from './types.js';

export interface Config {
  dataDir: string;
  worktreeDir: string;
  artifactsDir: string;
  uiPort: number;
  nvidia: { apiKey?: string; baseUrl: string };
  models: Record<string, string>;
  profiles: ModelProfile[];
  budgets: Record<string, Budget>;
  maxConcurrency: number;
  requestTimeoutMs: number;
  reviewerTimeoutMs: number;
  researcherTimeoutMs: number;
  fallowCommand: string;
  coderabbitEnabled: boolean;
  coderabbitCommand: string;
}

function loadDotEnv(root: string) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

const defaults: ModelProfile[] = [
  { id: 'builder', provider: 'nvidia', model: 'moonshotai/kimi-k3', capabilities: ['coding', 'reasoning', 'agentic', 'vision'], maxConcurrent: 1, enabled: true, health: 'unknown', contextWindow: 1000000, supportsReasoning: true, supportsVision: true, supportsTools: true, priority: 10 },
  { id: 'reviewer', provider: 'nvidia', model: 'moonshotai/kimi-k3', capabilities: ['review', 'reasoning', 'coding', 'agentic'], maxConcurrent: 1, enabled: true, health: 'unknown', contextWindow: 1000000, supportsReasoning: true, supportsTools: true, priority: 10 },
  { id: 'researcher', provider: 'nvidia', model: 'moonshotai/kimi-k3', capabilities: ['reasoning', 'research', 'coding', 'agentic'], maxConcurrent: 1, enabled: true, health: 'unknown', contextWindow: 1000000, supportsReasoning: true, supportsTools: true, priority: 10 },
  { id: 'recovery', provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b', capabilities: ['coding', 'reasoning', 'recovery', 'agentic'], maxConcurrent: 2, enabled: true, health: 'unknown', contextWindow: 1000000, supportsReasoning: true, supportsTools: true, priority: 20 },
  { id: 'planner', provider: 'nvidia', model: 'deepseek-ai/deepseek-v4-pro-0813', capabilities: ['planning', 'reasoning', 'coding', 'research', 'agentic'], maxConcurrent: 1, enabled: true, health: 'unknown', contextWindow: 1000000, supportsReasoning: true, supportsTools: true, priority: 10 },
  { id: 'coding-specialist', provider: 'nvidia', model: 'poolside/laguna-xs-2.1', capabilities: ['coding', 'reasoning', 'agentic', 'recovery'], maxConcurrent: 1, enabled: true, health: 'unknown', contextWindow: 1000000, supportsReasoning: true, supportsTools: true, priority: 30 }
];

function parseProfiles(): ModelProfile[] {
  const raw = process.env.ACP_MODELS_JSON;
  if (!raw) return defaults.map(p => ({ ...p }));
  try {
    const parsed = JSON.parse(raw) as ModelProfile[];
    return parsed.length ? parsed.map(p => ({ health: 'unknown', ...p })) : defaults.map(p => ({ ...p }));
  } catch {
    return defaults.map(p => ({ ...p }));
  }
}

const defaultBudgets: Record<string, Budget> = {
  low: { maxTokens: 20000, maxRequests: 10, maxDurationMinutes: 10, maxAgents: 1 },
  medium: { maxTokens: 80000, maxRequests: 30, maxDurationMinutes: 30, maxAgents: 2 },
  high: { maxTokens: 250000, maxRequests: 80, maxDurationMinutes: 90, maxAgents: 5 },
  maximum: { maxTokens: 750000, maxRequests: 200, maxDurationMinutes: 240, maxAgents: 12 }
};

export function loadConfig(root = process.cwd()): Config {
  loadDotEnv(root);
  const profiles = parseProfiles();
  const models = Object.fromEntries(profiles.map(p => [p.id, p.model]));
  return {
    dataDir: path.resolve(root, process.env.ACP_DATA_DIR ?? '.data'),
    worktreeDir: path.resolve(root, process.env.ACP_WORKTREE_DIR ?? 'worktrees'),
    artifactsDir: path.resolve(root, process.env.ACP_ARTIFACTS_DIR ?? '.data/artifacts'),
    uiPort: Number(process.env.ACP_UI_PORT ?? 4317),
    nvidia: { apiKey: process.env.NVIDIA_API_KEY, baseUrl: process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1' },
    models,
    profiles,
    budgets: defaultBudgets,
    maxConcurrency: Number(process.env.ACP_MAX_CONCURRENCY ?? 4),
    requestTimeoutMs: Number(process.env.ACP_REQUEST_TIMEOUT_MS ?? 45000),
    reviewerTimeoutMs: Number(process.env.ACP_REVIEWER_TIMEOUT_MS ?? 90000),
    researcherTimeoutMs: Number(process.env.ACP_RESEARCHER_TIMEOUT_MS ?? 90000),
    fallowCommand: process.env.FALLOW_COMMAND ?? 'npx fallow',
    coderabbitEnabled: process.env.CODERABBIT_ENABLED === 'true',
    coderabbitCommand: process.env.CODERABBIT_COMMAND ?? 'cr'
  };
}
