// Finds and removes what `/run` leaves behind.
//
// Every run keeps its worktree and branch so the user can review the work.
// Left alone they pile up, so ACP can list them and remove the ones that
// hold nothing. A run that holds work is never removed unless the user names
// it and says so.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Only branches `/run` creates. Task worktrees and the user's own
// branches are not ACP runs and are never touched.
const RUN_BRANCH = 'acp/run-';

export interface RunInfo {
  /** The run's name, for example `run-mwf3d693`. */
  id: string;
  branch: string;
  /** Missing when the folder was already deleted and only the branch is left. */
  worktree?: string;
  /** Files changed or added in the worktree and not committed. */
  uncommitted: number;
  /** Commits on the run's branch that no other branch has. */
  commits: number;
}

export const holdsWork = (run: RunInfo) => run.uncommitted > 0 || run.commits > 0;

async function git(root: string, args: string[]): Promise<string> {
  return (await exec('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout;
}

export async function listRuns(root: string): Promise<RunInfo[]> {
  // Forget worktrees whose folders were deleted by hand, so they do not
  // appear to exist.
  await git(root, ['worktree', 'prune']);

  const worktrees = new Map<string, string>();
  let current = '';
  for (const line of (await git(root, ['worktree', 'list', '--porcelain'])).split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    else if (line.startsWith('branch refs/heads/')) worktrees.set(line.slice('branch refs/heads/'.length), current);
  }

  const branches = (await git(root, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${RUN_BRANCH}*`])).split('\n').filter(Boolean).sort();

  return Promise.all(branches.map(async branch => {
    const worktree = worktrees.get(branch);
    const exists = worktree !== undefined && fs.existsSync(worktree);
    const uncommitted = exists ? (await git(worktree, ['status', '--porcelain', '-uall'])).split('\n').filter(Boolean).length : 0;
    // Commits reachable from this branch and from no other branch or remote.
    // `--all` is avoided on purpose: it also counts the HEAD of every
    // worktree, and this run's own worktree would then hide its commits.
    const commits = Number((await git(root, ['rev-list', '--count', `refs/heads/${branch}`, '--not', `--exclude=${branch}`, '--branches', '--remotes'])).trim());
    return { id: branch.slice('acp/'.length), branch, worktree: exists ? worktree : undefined, uncommitted, commits };
  }));
}

export async function removeRun(root: string, run: RunInfo): Promise<void> {
  // `--force` because the attached design skills are untracked files, which
  // Git otherwise treats as work that would be lost.
  if (run.worktree) await git(root, ['worktree', 'remove', '--force', run.worktree]);
  await git(root, ['branch', '-D', run.branch]);
}

export async function cleanRuns(root: string): Promise<{ removed: string[]; kept: RunInfo[] }> {
  const removed: string[] = [];
  const kept: RunInfo[] = [];
  // One at a time: Git locks the repository while it removes a worktree.
  for (const run of await listRuns(root)) {
    if (holdsWork(run)) kept.push(run);
    else { await removeRun(root, run); removed.push(run.id); }
  }
  return { removed, kept };
}
