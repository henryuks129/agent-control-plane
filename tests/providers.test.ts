import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, agentById } from '../src/providers/registry.js';
import { listAgents, runCommand, type CommandResult, type CommandRunner } from '../src/providers/detect.js';

// The agents are other companies' command-line tools. Tests stand in for them
// with their real output, captured from each tool, so no account is needed.
const ok = (stdout: string, stderr = ''): CommandResult => ({ code: 0, stdout, stderr, missing: false });
const missing: CommandResult = { code: null, stdout: '', stderr: '', missing: true };

const CLAUDE_IN = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'person@example.com', orgId: 'org-123', orgName: 'Private Org', subscriptionType: 'pro' });
const CLAUDE_OUT = JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' });
const OPENCODE_LIST = 'Cloudflare Workers AI  API key                     stored\nNvidia                 Nvidia                      stored\nZ.AI                   API key                     stored\n';

function fakeTools(table: Record<string, CommandResult>): CommandRunner {
  return async (binary, args) => table[`${binary} ${args.join(' ')}`] ?? missing;
}

// ---- Reading each tool's sign-in status ----

test('Claude Code signed in reports the plan and never the email or organisation', () => {
  const status = agentById('claude')!.parseStatus(CLAUDE_IN);
  assert.deepEqual(status, { signedIn: true, detail: 'Claude Pro plan' });
});

test('Claude Code signed out is reported as not signed in', () => {
  assert.equal(agentById('claude')!.parseStatus(CLAUDE_OUT).signedIn, false);
});

test('Claude Code output that is not JSON falls back to reading the words', () => {
  assert.equal(agentById('claude')!.parseStatus('Not logged in. Run claude auth login.').signedIn, false);
  assert.equal(agentById('claude')!.parseStatus('Logged in as someone').signedIn, true);
});

test('Codex reports how it is signed in', () => {
  assert.deepEqual(agentById('codex')!.parseStatus('Logged in using ChatGPT\n'), { signedIn: true, detail: 'Signed in with ChatGPT' });
  assert.equal(agentById('codex')!.parseStatus('Not logged in\n').signedIn, false);
});

test('OpenCode lists the providers it has keys for, without the keys', () => {
  assert.deepEqual(agentById('opencode')!.parseStatus(OPENCODE_LIST), { signedIn: true, detail: '3 providers: Cloudflare Workers AI, Nvidia, Z.AI' });
  assert.equal(agentById('opencode')!.parseStatus('').signedIn, false);
});

test('OpenCode output with colour codes is read the same way', () => {
  const coloured = '\u001b[1mNvidia\u001b[0m                 Nvidia                      \u001b[32mstored\u001b[0m\n';
  assert.deepEqual(agentById('opencode')!.parseStatus(coloured), { signedIn: true, detail: '1 provider: Nvidia' });
});

// ---- Finding the agents on this computer ----

test('the three supported agents are known, in a fixed order', () => {
  assert.deepEqual(AGENTS.map(agent => agent.id), ['claude', 'codex', 'opencode']);
});

test('an installed, signed-in agent is listed with its version', async () => {
  const agents = await listAgents(fakeTools({
    'claude --version': ok('2.1.190 (Claude Code)\n'),
    'claude auth status': ok(CLAUDE_IN),
  }));
  assert.deepEqual(agents[0], { id: 'claude', name: 'Claude Code', installed: true, version: '2.1.190', signedIn: true, detail: 'Claude Pro plan' });
});

test('a tool that is not on this computer is listed as not installed, with how to get it', async () => {
  const agents = await listAgents(fakeTools({}));
  assert.equal(agents.length, 3);
  assert.deepEqual({ installed: agents[1].installed, signedIn: agents[1].signedIn }, { installed: false, signedIn: false });
  assert.match(agents[1].next ?? '', /install/i);
});

test('an installed tool that is signed out says which command signs it in', async () => {
  const agents = await listAgents(fakeTools({ 'codex --version': ok('codex-cli 0.160.0\n'), 'codex login status': { code: 1, stdout: '', stderr: 'Not logged in\n', missing: false } }));
  const codex = agents.find(agent => agent.id === 'codex')!;
  assert.deepEqual({ installed: codex.installed, version: codex.version, signedIn: codex.signedIn, next: codex.next }, { installed: true, version: '0.160.0', signedIn: false, next: 'Run: codex login' });
});

// ---- Starting an agent ----

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { composePrompt, runAgent } from '../src/providers/run.js';
import { runAgentsCommand } from '../src/providers/cli.js';

test('ask mode starts every agent in its read-only setting', () => {
  assert.deepEqual(agentById('claude')!.runArgs('ask', '/w'), ['-p', '--permission-mode', 'plan']);
  assert.deepEqual(agentById('codex')!.runArgs('ask', '/w'), ['exec', '--sandbox', 'read-only', '-C', '/w', '-']);
  assert.deepEqual(agentById('opencode')!.runArgs('ask', '/w'), ['run', '--agent', 'plan']);
});

test('edit mode lets an agent write, and Codex is confined to the worktree folder', () => {
  assert.deepEqual(agentById('claude')!.runArgs('edit', '/w'), ['-p', '--permission-mode', 'acceptEdits']);
  assert.deepEqual(agentById('codex')!.runArgs('edit', '/w'), ['exec', '--sandbox', 'workspace-write', '-C', '/w', '-']);
  assert.deepEqual(agentById('opencode')!.runArgs('edit', '/w'), ['run', '--agent', 'build', '--auto']);
});

test('the prompt gives memory first and the request last', () => {
  assert.equal(composePrompt('Add a form', '# ACP memory\nRule.\n'), '# ACP memory\nRule.\n\n# Request\nAdd a form');
  assert.equal(composePrompt('Add a form', ''), 'Add a form');
});

function tempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-agents-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.mkdirSync(path.join(root, '.acp/rules'), { recursive: true });
  fs.writeFileSync(path.join(root, '.acp/rules/api.md'), '---\npaths: [src/api/**]\n---\nValidate input.');
  fs.writeFileSync(path.join(root, 'README.md'), 'hello\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return root;
}

/** Stands in for Codex: signed in, and "edits" by writing one file where it is started. */
function fakeCodex(calls: Array<{ args: string[]; cwd?: string; input?: string; timeoutMs?: number }>, signedIn = true): CommandRunner {
  return async (binary, args, options) => {
    if (binary !== 'codex') return missing;
    if (args[0] === '--version') return ok('codex-cli 0.160.0\n');
    if (args[0] === 'login') return signedIn ? ok('Logged in using ChatGPT\n') : { code: 1, stdout: '', stderr: 'Not logged in\n', missing: false };
    calls.push({ args, cwd: options?.cwd, input: options?.input, timeoutMs: options?.timeoutMs });
    fs.writeFileSync(path.join(options!.cwd!, 'notes.txt'), 'written by the agent\n');
    return ok('done\n');
  };
}

test('a run happens in its own worktree, with matching memory, and reports what changed', async () => {
  const root = tempRepo();
  const worktreeDir = path.join(root, 'worktrees');
  const calls: Array<{ args: string[]; cwd?: string; input?: string; timeoutMs?: number }> = [];
  const result = await runAgent(
    { root, worktreeDir, dataDir: path.join(root, '.data'), agentId: 'codex', request: 'Add an endpoint', mode: 'edit', files: ['src/api/a.ts'], runId: 'run-1' },
    { run: fakeCodex(calls) },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, path.join(worktreeDir, 'run-1'));
  const prompt = calls[0].input!;
  assert.match(prompt, /Validate input\.[\s\S]*# Request\nAdd an endpoint$/);
  assert.deepEqual({ agent: result.agent, branch: result.branch, exitCode: result.exitCode, changed: result.changed }, { agent: 'Codex', branch: 'acp/run-1', exitCode: 0, changed: ['notes.txt'] });
  assert.equal(fs.existsSync(path.join(root, 'notes.txt')), false, 'the project itself is untouched');
});

test('an agent that is signed out is not started, and the message says how to sign in', async () => {
  const root = tempRepo();
  const calls: Array<{ args: string[]; cwd?: string; input?: string; timeoutMs?: number }> = [];
  await assert.rejects(
    runAgent({ root, worktreeDir: path.join(root, 'worktrees'), dataDir: root, agentId: 'codex', request: 'x', mode: 'ask', files: [], runId: 'run-2' }, { run: fakeCodex(calls, false) }),
    /Codex is not signed in\. Run: codex login/,
  );
  assert.equal(calls.length, 0);
});

test('an unknown agent name lists the ones ACP supports', async () => {
  await assert.rejects(
    runAgent({ root: '.', worktreeDir: '.', dataDir: '.', agentId: 'gpt', request: 'x', mode: 'ask', files: [], runId: 'r' }, { run: fakeTools({}) }),
    /Unknown agent "gpt"\. Use one of: claude, codex, opencode/,
  );
});

// ---- Commands ----

const here = { root: '.', worktreeDir: './worktrees', dataDir: './.data' };

test('agents:list shows each agent, its sign-in and what to do next', async () => {
  const result = await runAgentsCommand('agents:list', [], here, { run: fakeTools({ 'claude --version': ok('2.1.190 (Claude Code)'), 'claude auth status': ok(CLAUDE_IN), 'codex --version': ok('codex-cli 0.160.0'), 'codex login status': ok('Not logged in') }) });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /claude\s+Claude Code\s+2\.1\.190\s+ready\s+Claude Pro plan/);
  assert.match(result.output, /codex\s+Codex\s+0\.160\.0\s+signed out\s+Run: codex login/);
  assert.match(result.output, /opencode\s+OpenCode\s+-\s+not installed/);
  assert.doesNotMatch(result.output, /person@example\.com|Private Org/);
});

test('agents:run without a request explains how to use it', async () => {
  const result = await runAgentsCommand('agents:run', ['codex'], here, { run: fakeTools({}) });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /agents:run <agent> \[--edit\] \[--files a,b\] "<request>"/);
});

test('agents:run reports the worktree, the branch and the changed files', async () => {
  const root = tempRepo();
  const result = await runAgentsCommand('agents:run', ['codex', '--edit', '--files', 'src/api/a.ts', 'Add an endpoint'], { root, worktreeDir: path.join(root, 'worktrees'), dataDir: root }, { run: fakeCodex([]) });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /Codex finished[\s\S]*Branch:\s+acp\/run-[\w-]+[\s\S]*Changed files:\n  notes\.txt[\s\S]*Nothing has been merged/);
});

// ---- Choosing a model, and a sign-in that stopped working ----

test('a chosen model is passed to each agent in its own way', () => {
  assert.deepEqual(agentById('claude')!.runArgs('ask', '/w', 'sonnet'), ['-p', '--permission-mode', 'plan', '--model', 'sonnet']);
  assert.deepEqual(agentById('codex')!.runArgs('ask', '/w', 'gpt-x'), ['exec', '--sandbox', 'read-only', '-C', '/w', '--model', 'gpt-x', '-']);
  assert.deepEqual(agentById('opencode')!.runArgs('ask', '/w', 'nvidia/some-model'), ['run', '--agent', 'plan', '--model', 'nvidia/some-model']);
});

test('agents:run --model reaches the agent', async () => {
  const root = tempRepo();
  const calls: Array<{ args: string[]; cwd?: string; input?: string; timeoutMs?: number }> = [];
  await runAgentsCommand('agents:run', ['codex', '--model', 'gpt-x', 'Say hi'], { root, worktreeDir: path.join(root, 'worktrees'), dataDir: root }, { run: fakeCodex(calls) });
  assert.deepEqual(calls[0].args.slice(0, 7), ['exec', '--sandbox', 'read-only', '-C', calls[0].cwd, '--model', 'gpt-x']);
});

test('when a tool says it is signed in but the run is refused, the user is told to sign in again', async () => {
  const root = tempRepo();
  const refused: CommandRunner = async (binary, args) => {
    if (args[0] === '--version') return ok('2.1.190 (Claude Code)');
    if (args[0] === 'auth') return ok(CLAUDE_IN);
    return { code: 1, stdout: 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.\n', stderr: '', missing: false };
  };
  const result = await runAgentsCommand('agents:run', ['claude', 'Say hi'], { root, worktreeDir: path.join(root, 'worktrees'), dataDir: root }, { run: refused });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Claude Code's sign-in was refused\. Sign in again with: claude auth login/);
});

test('an ordinary failure is not mistaken for a sign-in problem', async () => {
  const root = tempRepo();
  const failing: CommandRunner = async (binary, args) => {
    if (args[0] === '--version') return ok('codex-cli 0.160.0');
    if (args[0] === 'login') return ok('Logged in using ChatGPT');
    return { code: 1, stdout: 'Model x is not available on this plan.\n', stderr: '', missing: false };
  };
  const result = await runAgentsCommand('agents:run', ['codex', 'Say hi'], { root, worktreeDir: path.join(root, 'worktrees'), dataDir: root }, { run: failing });
  assert.doesNotMatch(result.output, /sign-in was refused/);
  assert.match(result.output, /--model/, 'a failed run suggests trying another model');
});

// ---- Design skills attach on their own ----

test('a design request gets the design skills in its worktree and is told to follow them', async () => {
  const root = tempRepo();
  const worktreeDir = path.join(root, 'worktrees');
  const calls: Array<{ args: string[]; cwd?: string; input?: string; timeoutMs?: number }> = [];
  const result = await runAgent(
    { root, worktreeDir, dataDir: path.join(root, '.data'), agentId: 'codex', request: 'Build a landing page', mode: 'edit', files: [], runId: 'run-design' },
    { run: fakeCodex(calls) },
  );
  const worktree = path.join(worktreeDir, 'run-design');
  assert.ok(fs.existsSync(path.join(worktree, '.agents/skills/impeccable/SKILL.md')));
  assert.ok(fs.existsSync(path.join(worktree, '.claude/skills/awwwards/SKILL.md')));
  assert.match(calls[0].input!, /# Design skills\n[\s\S]*- impeccable: [\s\S]*# Request\nBuild a landing page$/);
  assert.deepEqual(result.skills, ['impeccable', 'awwwards']);
  assert.deepEqual(result.changed, ['notes.txt'], 'the skills are not reported as changes');
});

test('a request that is not design work gets no design skills', async () => {
  const root = tempRepo();
  const worktreeDir = path.join(root, 'worktrees');
  const calls: Array<{ args: string[]; cwd?: string; input?: string; timeoutMs?: number }> = [];
  const result = await runAgent(
    { root, worktreeDir, dataDir: path.join(root, '.data'), agentId: 'codex', request: 'Add an endpoint', mode: 'edit', files: ['src/api/a.ts'], runId: 'run-plain' },
    { run: fakeCodex(calls) },
  );
  assert.equal(fs.existsSync(path.join(worktreeDir, 'run-plain', '.agents')), false);
  assert.doesNotMatch(calls[0].input!, /Design skills/);
  assert.deepEqual(result.skills, []);
});

test('a project that turns design skills off gets none, even for design work', async () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, '.acp/settings.json'), JSON.stringify({ designSkills: false }));
  const worktreeDir = path.join(root, 'worktrees');
  const calls: Array<{ args: string[]; cwd?: string; input?: string; timeoutMs?: number }> = [];
  const result = await runAgent(
    { root, worktreeDir, dataDir: path.join(root, '.data'), agentId: 'codex', request: 'Build a landing page', mode: 'edit', files: [], runId: 'run-off' },
    { run: fakeCodex(calls) },
  );
  assert.deepEqual(result.skills, []);
  assert.doesNotMatch(calls[0].input!, /Design skills/);
});

test('agents:run says which design skills were attached', async () => {
  const root = tempRepo();
  const result = await runAgentsCommand('agents:run', ['codex', 'Build', 'a', 'landing', 'page'], { root, worktreeDir: path.join(root, 'worktrees'), dataDir: path.join(root, '.data') }, { run: fakeCodex([]) });
  assert.match(result.output, /Design skills: impeccable, awwwards/);
});

// ---- The request stays private, and a run that runs out of time says so ----

test('the request is sent on standard input, never as a command-line argument', async () => {
  const root = tempRepo();
  const calls: Array<{ args: string[]; cwd?: string; input?: string; timeoutMs?: number }> = [];
  await runAgent(
    { root, worktreeDir: path.join(root, 'worktrees'), dataDir: root, agentId: 'codex', request: 'Rotate the billing token', mode: 'ask', files: [], runId: 'run-private' },
    { run: fakeCodex(calls) },
  );
  // Arguments are visible to every user of the computer in the process list.
  assert.equal(calls[0].args.some(arg => arg.includes('billing token')), false);
  assert.match(calls[0].input!, /Rotate the billing token$/);
});

test('the real runner delivers standard input to the program', async () => {
  const result = await runCommand(process.execPath, ['-e', "process.stdin.on('data', d => process.stdout.write(String(d).toUpperCase()))"], { input: 'hello' });
  assert.equal(result.stdout, 'HELLO');
  assert.equal(result.timedOut, false);
});

test('the real runner stops a program that takes too long and reports it as timed out', async () => {
  const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(result.code, null);
});

test('an edit gets longer than a question before it is stopped, and --timeout changes it', async () => {
  const root = tempRepo();
  const where = { root, worktreeDir: path.join(root, 'worktrees'), dataDir: root };
  const calls: Array<{ args: string[]; cwd?: string; input?: string; timeoutMs?: number }> = [];
  await runAgentsCommand('agents:run', ['codex', 'Say hi'], where, { run: fakeCodex(calls) });
  await runAgentsCommand('agents:run', ['codex', '--edit', 'Say hi'], where, { run: fakeCodex(calls) });
  await runAgentsCommand('agents:run', ['codex', '--timeout', '45', 'Say hi'], where, { run: fakeCodex(calls) });
  assert.deepEqual(calls.map(call => call.timeoutMs), [15 * 60_000, 30 * 60_000, 45 * 60_000]);
});

test('a run that ran out of time says so, keeps its work, and does not blame the model', async () => {
  const root = tempRepo();
  const slow: CommandRunner = async (binary, args, options) => {
    if (binary !== 'codex') return missing;
    if (args[0] === '--version') return ok('codex-cli 0.160.0');
    if (args[0] === 'login') return ok('Logged in using ChatGPT');
    fs.writeFileSync(path.join(options!.cwd!, 'half.txt'), 'partly done\n');
    return { code: null, stdout: '', stderr: '', missing: false, timedOut: true };
  };
  const result = await runAgentsCommand('agents:run', ['codex', '--edit', 'Build it'], { root, worktreeDir: path.join(root, 'worktrees'), dataDir: root }, { run: slow });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Codex was stopped after 30 minutes/);
  assert.match(result.output, /half\.txt/);
  assert.match(result.output, /--timeout <minutes>/);
  assert.doesNotMatch(result.output, /not available on your plan/);
});

test('after a design run, the changed files are checked and findings are reported as evidence', async () => {
  const root = tempRepo();
  const sloppy: CommandRunner = async (binary, args, options) => {
    if (binary !== 'codex') return missing;
    if (args[0] === '--version') return ok('codex-cli 0.160.0');
    if (args[0] === 'login') return ok('Logged in using ChatGPT');
    fs.writeFileSync(path.join(options!.cwd!, 'index.html'), '<h1>Hi</h1>\n<a href="#">Buy</a>\n');
    return ok('done');
  };
  const result = await runAgentsCommand('agents:run', ['codex', '--edit', 'Build a landing page'], { root, worktreeDir: path.join(root, 'worktrees'), dataDir: root }, { run: sloppy });
  assert.match(result.output, /Design check: 1 finding \(pattern matches in the files, not opinions\)/);
  assert.match(result.output, /index\.html:2\s+dead-link/);
});

test('a run that is not design work is not design-checked', async () => {
  const root = tempRepo();
  const result = await runAgentsCommand('agents:run', ['codex', '--edit', 'Add an endpoint'], { root, worktreeDir: path.join(root, 'worktrees'), dataDir: root }, { run: fakeCodex([]) });
  assert.doesNotMatch(result.output, /Design check/);
});
