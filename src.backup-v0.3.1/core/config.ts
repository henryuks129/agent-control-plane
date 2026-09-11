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

function parseProfiles(): ModelProfile[] {
  const fallback: ModelProfile[] = [
    { id: 'builder', provider: 'nvidia', model: process.env.ACP_BUILDER_MODEL ?? 'z-ai/glm-5.2', capabilities: ['coding', 'reasoning'], maxConcurrent: 1, enabled: true },
    { id: 'reviewer', provider: 'nvidia', model: process.env.ACP_REVIEWER_MODEL ?? 'z-ai/glm-5.2', capabilities: ['review', 'reasoning', 'coding'], maxConcurrent: 1, enabled: true },
    { id: 'researcher', provider: 'nvidia', model: process.env.ACP_RESEARCHER_MODEL ?? 'deepseek-ai/deepseek-v4-flash-0731', capabilities: ['reasoning', 'research'], maxConcurrent: 1, enabled: true },
    { id: 'recovery', provider: 'nvidia', model: process.env.ACP_RECOVERY_MODEL ?? 'z-ai/glm-5.2', capabilities: ['coding', 'reasoning', 'recovery'], maxConcurrent: 1, enabled: true }
  ];
  const raw = process.env.ACP_MODELS_JSON;
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as ModelProfile[];
    return parsed.length ? parsed : fallback;
  } catch {
    return fallback;
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
  return {
    dataDir: path.resolve(root, process.env.ACP_DATA_DIR ?? '.data'),
    worktreeDir: path.resolve(root, process.env.ACP_WORKTREE_DIR ?? 'worktrees'),
    artifactsDir: path.resolve(root, process.env.ACP_ARTIFACTS_DIR ?? '.data/artifacts'),
    uiPort: Number(process.env.ACP_UI_PORT ?? 4317),
    nvidia: { apiKey: process.env.NVIDIA_API_KEY, baseUrl: process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1' },
    models: {
      builder: process.env.ACP_BUILDER_MODEL ?? 'z-ai/glm-5.2',
      reviewer: process.env.ACP_REVIEWER_MODEL ?? 'z-ai/glm-5.2',
      researcher: process.env.ACP_RESEARCHER_MODEL ?? 'deepseek-ai/deepseek-v4-flash-0731',
      recovery: process.env.ACP_RECOVERY_MODEL ?? 'z-ai/glm-5.2'
    },
    profiles: parseProfiles(),
    budgets: defaultBudgets,
    maxConcurrency: Number(process.env.ACP_MAX_CONCURRENCY ?? 4),
    fallowCommand: process.env.FALLOW_COMMAND ?? 'npx fallow',
    coderabbitEnabled: process.env.CODERABBIT_ENABLED === 'true',
    coderabbitCommand: process.env.CODERABBIT_COMMAND ?? 'cr'
  };
}
