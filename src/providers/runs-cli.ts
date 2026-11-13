// The `runs:*` commands: see and clear what agent runs leave behind.

import { cleanRuns, holdsWork, listRuns, removeRun, type RunInfo } from './runs.js';

export const RUNS_USAGE = `Run commands:
  runs:list                       show every agent run still on this computer and what it holds
  runs:clean                      remove the runs that changed nothing (runs that hold work are kept)
  runs:remove <run> [--force]     remove one run; --force is needed when it holds work`;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function describe(run: RunInfo): string {
  const parts: string[] = [];
  if (run.commits) parts.push(plural(run.commits, 'commit'));
  if (run.uncommitted) parts.push(`${plural(run.uncommitted, 'changed file')}, not committed`);
  return parts.join(' and ') || 'no changes';
}

export async function runRunsCommand(command: string, args: string[], where: { root: string }): Promise<{ output: string; exitCode: number }> {
  if (command === 'runs:list') {
    const runs = await listRuns(where.root);
    if (runs.length === 0) return { output: 'No runs.', exitCode: 0 };
    const rows = runs.map(run => [run.id, describe(run), holdsWork(run) ? 'to review' : 'safe to remove', run.worktree ?? '(folder already deleted)']);
    const widths = [0, 1, 2].map(column => Math.max(...rows.map(row => row[column].length)));
    return { output: rows.map(row => row.map((cell, column) => (column < 3 ? cell.padEnd(widths[column] + 2) : cell)).join('')).join('\n'), exitCode: 0 };
  }

  if (command === 'runs:clean') {
    const { removed, kept } = await cleanRuns(where.root);
    const lines = [removed.length ? `Removed ${plural(removed.length, 'run')} with no changes: ${removed.join(', ')}` : 'No runs without changes to remove.'];
    if (kept.length) lines.push(`Kept ${plural(kept.length, 'run')} that hold${kept.length === 1 ? 's' : ''} work: ${kept.map(run => run.id).join(', ')}`);
    return { output: lines.join('\n'), exitCode: 0 };
  }

  if (command === 'runs:remove') {
    const id = args.find(arg => !arg.startsWith('--'));
    if (!id) return { output: RUNS_USAGE, exitCode: 1 };
    const runs = await listRuns(where.root);
    const run = runs.find(candidate => candidate.id === id);
    if (!run) return { output: `No run called "${id}". Runs: ${runs.map(candidate => candidate.id).join(', ') || 'none'}`, exitCode: 1 };
    // Deleting work cannot be undone, so it takes a second, explicit word.
    if (holdsWork(run) && !args.includes('--force')) return { output: `${run.id} holds work (${describe(run)}). Add --force to delete it.`, exitCode: 1 };
    await removeRun(where.root, run);
    return { output: `Removed ${run.id}.`, exitCode: 0 };
  }

  return { output: RUNS_USAGE, exitCode: 1 };
}
