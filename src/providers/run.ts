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
import { detectDesignTask } from '../design/detect.js';
import { checkFiles, type DesignFinding } from '../design/check.js';
import { attachSkills, availableSkills, loadDesignSetting, selectSkills, skillsNote } from '../design/skills.js';
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
  /** Minutes before the run is stopped. Optional: see `defaultTimeoutMinutes`. */
  timeoutMinutes?: number;
}

export interface RunResult {
  agent: string;
  worktree: string;
  branch: string;
  exitCode: number | null;
  /** Set when ACP stopped the run for taking too long: how many minutes it was given. */
  stoppedAfterMinutes?: number;
  output: string;
  /** Files the agent added or changed, relative to the worktree. */
  changed: string[];
  /** Design skills ACP placed in the worktree for this run. */
  skills: string[];
  /** Anti-patterns found in the files a design run changed. Evidence, not opinion. */
  designFindings: DesignFinding[];
  /** What to try next when the run failed. */
  hint?: string;
}

/**
 * An agent can work for a long time, but a run with nobody watching must
 * end. A question is answered in minutes. An edit reads, writes and checks
 * its own work, and a first real design run needed more than 15 minutes, so
 * edits get twice as long.
 */
export function defaultTimeoutMinutes(mode: RunMode): number {
  return mode === 'edit' ? 30 : 15;
}

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

  // Design work gets the shipped design skills without the user asking
  // (ADR-0008 §9k). Other work gets none, which keeps its context small.
  const isDesign = detectDesignTask({ files: input.files, request: input.request }).design;
  const wanted = isDesign ? selectSkills(availableSkills(input.root), input.request, loadDesignSetting(input.root)) : [];
  const { attached } = await attachSkills(worktree, wanted);
  // Name only what was really attached: a skill the project already keeps
  // under the same name is its own, and the agent finds it there anyway.
  const note = skillsNote(wanted.filter(skill => attached.includes(skill.name)));

  const prompt = composePrompt(input.request, [memory, note].filter(Boolean).join('\n'));

  const minutes = input.timeoutMinutes ?? defaultTimeoutMinutes(input.mode);
  const result = await deps.run(agent.binary, agent.runArgs(input.mode, worktree, input.model), {
    cwd: worktree,
    stream: true, // show the agent's progress as it happens
    timeoutMs: minutes * 60_000,
    input: prompt,
  });

  let hint: string | undefined;
  if (result.timedOut) {
    // Being stopped is not a failure of the model. Whatever the agent wrote
    // before it was stopped is still in the worktree for the user to judge.
    hint = `Its work so far is kept in the worktree. To give a run longer, add --timeout <minutes>.`;
  } else if (result.code !== 0) {
    hint = SIGN_IN_REFUSED.test(`${result.stdout}\n${result.stderr}`)
      ? `${agent.name}'s sign-in was refused. Sign in again with: ${agent.signInCommand}`
      : 'If the model is not available on your plan, choose another with --model <name>.';
  }

  const changed = await changedFiles(worktree);

  return {
    hint,
    agent: agent.name,
    worktree,
    branch: `acp/${input.runId}`,
    exitCode: result.code,
    stoppedAfterMinutes: result.timedOut ? minutes : undefined,
    output: result.stdout,
    changed,
    skills: attached,
    // Checked whether or not skills were attached: a project may turn the
    // skills off and still want to know what the result looks like.
    designFindings: isDesign ? checkFiles(worktree, changed) : [],
  };
}
