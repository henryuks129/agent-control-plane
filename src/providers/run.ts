// Runs one request through one agent.
//
// What a run guarantees:
//   - The agent works in its own Git worktree on its own branch, so the
//     project folder is never touched (AGENTS.md rule 6).
//   - Nothing is merged. The user reviews the branch and decides.
//   - The agent receives ACP's memory for the files involved (rule 2: the
//     task and what is relevant to it, not the whole repository).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitManager } from '../git/worktrees.js';
import { renderBundle, resolveMemory } from '../memory/resolve.js';
import { loadProjectMemory, loadUserMemory } from '../memory/store.js';
import { listAgents, type CommandRunner } from './detect.js';
import { AGENTS, agentById, type RunMode } from './registry.js';

const exec = promisify(execFile);

export interface RunInput {
  /** The project's folder. */
  root: string;
  /** Where ACP keeps worktrees. */
  worktreeDir: string;
  /** ACP's own storage, for the user layer of memory. */
  dataDir: string;
  agentId: string;
  request: string;
  mode: RunMode;
  /** Files the request is about. They decide which memory rules apply. */
  files: string[];
  /** Names the worktree and the branch (`acp/<runId>`). */
  runId: string;
  /** A specific model, in the agent's own naming. Optional. */
  model?: string;
}

export interface RunResult {
  agent: string;
  worktree: string;
  branch: string;
  exitCode: number | null;
  output: string;
  /** Files the agent added or changed, relative to the worktree. */
  changed: string[];
  /** What to try next when the run failed. */
  hint?: string;
}

// An agent can work for a long time, but a run with nobody watching must end.
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

// A tool can report "signed in" from a saved token that its service has since
// refused. The status check cannot see that; only a real run does.
const SIGN_IN_REFUSED = /\b401\b|failed to authenticate|token has been revoked|unauthori[sz]ed|not logged in/i;

/**
 * Memory goes first and the request last: the request is the thing to act
 * on, and agents weigh what they read most recently.
 */
export function composePrompt(request: string, memory: string): string {
  return memory ? `${memory}\n# Request\n${request}` : request;
}

async function changedFiles(worktree: string): Promise<string[]> {
  // `-uall` lists every new file instead of only its folder.
  const { stdout } = await exec('git', ['status', '--porcelain', '-uall'], { cwd: worktree });
  return stdout.split('\n').filter(Boolean).map(line => line.slice(3)).sort();
}

export async function runAgent(input: RunInput, deps: { run: CommandRunner }): Promise<RunResult> {
  const agent = agentById(input.agentId);
  if (!agent) throw new Error(`Unknown agent "${input.agentId}". Use one of: ${AGENTS.map(a => a.id).join(', ')}`);

  // Check before creating anything, so a failed start leaves no empty
  // worktree behind and the user gets the fix instead of a tool's raw error.
  const status = (await listAgents(deps.run)).find(candidate => candidate.id === agent.id)!;
  if (!status.installed) throw new Error(`${agent.name} is not installed. ${agent.installHint}`);
  if (!status.signedIn) throw new Error(`${agent.name} is not signed in. Run: ${agent.signInCommand}`);

  const worktree = await new GitManager(input.root, input.worktreeDir).ensureWorktree(input.runId);

  // Memory is read from the project folder, not the worktree, so rules the
  // user has written but not committed yet still apply.
  const memory = renderBundle(resolveMemory({
    project: loadProjectMemory(input.root),
    user: loadUserMemory(input.dataDir),
    files: input.files,
    request: input.request,
  }));
  const prompt = composePrompt(input.request, memory);

  const result = await deps.run(agent.binary, agent.runArgs(input.mode, prompt, worktree, input.model), {
    cwd: worktree,
    stream: true, // show the agent's progress as it happens
    timeoutMs: RUN_TIMEOUT_MS,
  });

  let hint: string | undefined;
  if (result.code !== 0) {
    hint = SIGN_IN_REFUSED.test(`${result.stdout}\n${result.stderr}`)
      ? `${agent.name}'s sign-in was refused. Sign in again with: ${agent.signInCommand}`
      : 'If the model is not available on your plan, choose another with --model <name>.';
  }

  return {
    hint,
    agent: agent.name,
    worktree,
    branch: `acp/${input.runId}`,
    exitCode: result.code,
    output: result.stdout,
    changed: await changedFiles(worktree),
  };
}
