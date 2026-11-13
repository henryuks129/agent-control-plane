import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitManager } from '../src/git/worktrees.js';
import { cleanRuns, listRuns } from '../src/providers/runs.js';
import { runRunsCommand } from '../src/providers/runs-cli.js';

function tempRepo(): { root: string; worktreeDir: string; git: (...args: string[]) => string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-runs-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(root, 'README.md'), 'hello\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return { root, worktreeDir: path.join(root, 'worktrees'), git };
}

/** Three runs: one that changed nothing, one with an unsaved file, one with a commit. */
async function threeRuns() {
  const repo = tempRepo();
  const manager = new GitManager(repo.root, repo.worktreeDir);
  await manager.ensureWorktree('run-empty');
  const edited = await manager.ensureWorktree('run-edited');
  fs.writeFileSync(path.join(edited, 'notes.txt'), 'work\n');
  const committed = await manager.ensureWorktree('run-committed');
  fs.writeFileSync(path.join(committed, 'done.txt'), 'work\n');
  execFileSync('git', ['add', '-A'], { cwd: committed });
  execFileSync('git', ['commit', '-q', '-m', 'work'], { cwd: committed });
  return repo;
}

test('runs are listed with what each one holds', async () => {
  const repo = await threeRuns();
  const runs = await listRuns(repo.root);
  assert.deepEqual(runs.map(run => [run.id, run.uncommitted, run.commits, Boolean(run.worktree)]), [
    ['run-committed', 0, 1, true],
    ['run-edited', 1, 0, true],
    ['run-empty', 0, 0, true],
  ]);
});

test('worktrees ACP did not make for a run are never listed', async () => {
  const repo = await threeRuns();
  await new GitManager(repo.root, repo.worktreeDir).ensureWorktree('TASK-0001');
  repo.git('branch', 'feature/mine');
  assert.equal((await listRuns(repo.root)).some(run => !run.id.startsWith('run-')), false);
});

test('clean removes only runs with nothing in them: worktree and branch both', async () => {
  const repo = await threeRuns();
  const report = await cleanRuns(repo.root);
  assert.deepEqual(report.removed, ['run-empty']);
  assert.deepEqual(report.kept.map(run => run.id), ['run-committed', 'run-edited']);
  assert.equal(fs.existsSync(path.join(repo.worktreeDir, 'run-empty')), false);
  assert.doesNotMatch(repo.git('branch', '--list'), /run-empty/);
  assert.ok(fs.existsSync(path.join(repo.worktreeDir, 'run-edited/notes.txt')), 'unsaved work is kept');
  assert.match(repo.git('branch', '--list'), /acp\/run-committed/);
});

test('a run whose folder was already deleted by hand is still cleaned up', async () => {
  const repo = await threeRuns();
  fs.rmSync(path.join(repo.worktreeDir, 'run-empty'), { recursive: true });
  const report = await cleanRuns(repo.root);
  assert.deepEqual(report.removed, ['run-empty']);
  assert.doesNotMatch(repo.git('branch', '--list'), /run-empty/);
});

test('runs:list shows each run and what to do with it', async () => {
  const repo = await threeRuns();
  const result = await runRunsCommand('runs:list', [], repo);
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /run-committed\s+1 commit\s+to review/);
  assert.match(result.output, /run-edited\s+1 changed file, not committed\s+to review/);
  assert.match(result.output, /run-empty\s+no changes\s+safe to remove/);
});

test('runs:list on a project with no runs says so', async () => {
  const result = await runRunsCommand('runs:list', [], tempRepo());
  assert.equal(result.output, 'No runs.');
});

test('runs:clean reports what it removed and what it left for review', async () => {
  const repo = await threeRuns();
  const result = await runRunsCommand('runs:clean', [], repo);
  assert.match(result.output, /Removed 1 run with no changes: run-empty/);
  assert.match(result.output, /Kept 2 runs that hold work: run-committed, run-edited/);
});

test('runs:remove refuses to delete work unless told to', async () => {
  const repo = await threeRuns();
  const refused = await runRunsCommand('runs:remove', ['run-edited'], repo);
  assert.equal(refused.exitCode, 1);
  assert.match(refused.output, /run-edited holds work \(1 changed file, not committed\)\. Add --force to delete it\./);
  assert.ok(fs.existsSync(path.join(repo.worktreeDir, 'run-edited')));

  const forced = await runRunsCommand('runs:remove', ['run-edited', '--force'], repo);
  assert.equal(forced.exitCode, 0);
  assert.equal(fs.existsSync(path.join(repo.worktreeDir, 'run-edited')), false);
});

test('runs:remove of an unknown run names the runs that exist', async () => {
  const repo = await threeRuns();
  const result = await runRunsCommand('runs:remove', ['run-nope'], repo);
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /No run called "run-nope"\. Runs: run-committed, run-edited, run-empty/);
});
