import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WORDS, resolveCommand, shown, slashMenu } from '../src/cli/command.js';

// These tests start the real command, the way a user or an agent's MCP
// client does. They need the built file, so they are skipped when the tests
// run straight from the TypeScript sources.
const main = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'main.js');
const built = fs.existsSync(main);
const acp = (args: string[], options: { input?: string; cwd?: string } = {}) =>
  spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', input: options.input, cwd: options.cwd ?? os.tmpdir() });

test('commands that do not use the database print no warning about it', { skip: !built }, () => {
  for (const command of [['skills'], ['memory', 'a.ts'], ['runs']]) {
    const result = acp(command);
    assert.equal(result.stderr, '', command.join(' '));
    assert.doesNotMatch(result.stdout, /\bat .+:\d+:\d+\)/, `${command.join(' ')} printed a stack trace`);
  }
});

test('help lists the everyday commands as acp and one word', { skip: !built }, () => {
  const { stdout } = acp(['help']);
  for (const word of ['run', 'agents', 'runs', 'clean', 'memory', 'sync', 'accept', 'skills', 'check', 'start', 'mcp']) {
    assert.match(stdout, new RegExp(`^  acp ${word}\\b`, 'm'), word);
  }
  assert.doesNotMatch(stdout, /acp \//, 'no command is shown as acp /word');
  assert.doesNotMatch(stdout, /^\s+acp [a-z]+:[a-z]/m, 'no command is shown with a colon');
});

test('the mcp command speaks the protocol on standard output and nothing else', { skip: !built }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cli-mcp-'));
  fs.mkdirSync(path.join(root, '.acp'));
  fs.writeFileSync(path.join(root, '.acp/knowledge.md'), 'Use pnpm.\n');
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_get', arguments: {} } },
  ].map(message => JSON.stringify(message)).join('\n') + '\n';
  const result = acp(['mcp'], { input, cwd: root });
  assert.equal(result.status, 0);
  // Any stray line on standard output would break the agent's connection.
  const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(replies.map(reply => reply.id), [1, 2]);
  assert.match(replies[1].result.content[0].text, /Use pnpm/);
});

// How a typed command becomes the name the rest of ACP uses. Everyday
// commands are one word: `acp memory` in a terminal, `/memory` in the app.
test('everyday commands are one word after acp', () => {
  assert.deepEqual(resolveCommand(['agents']), { command: 'agents:list', args: [] });
  assert.deepEqual(resolveCommand(['run', 'codex', '--edit', 'Build a page']), { command: 'agents:run', args: ['codex', '--edit', 'Build a page'] });
  assert.deepEqual(resolveCommand(['runs']), { command: 'runs:list', args: [] });
  assert.deepEqual(resolveCommand(['clean']), { command: 'runs:clean', args: [] });
  assert.deepEqual(resolveCommand(['remove', 'run-1', '--force']), { command: 'runs:remove', args: ['run-1', '--force'] });
  assert.deepEqual(resolveCommand(['memory', '--request', 'reset', 'a.ts']), { command: 'memory:show', args: ['--request', 'reset', 'a.ts'] });
  assert.deepEqual(resolveCommand(['init']), { command: 'memory:init', args: [] });
  assert.deepEqual(resolveCommand(['sync', '--check']), { command: 'memory:sync', args: ['--check'] });
  assert.deepEqual(resolveCommand(['proposals']), { command: 'memory:proposals', args: [] });
  assert.deepEqual(resolveCommand(['accept', 'dates']), { command: 'memory:accept', args: ['dates'] });
  assert.deepEqual(resolveCommand(['check', 'a.html']), { command: 'design:check', args: ['a.html'] });
  assert.deepEqual(resolveCommand(['start']), { command: 'ui', args: [] });
  assert.deepEqual(resolveCommand(['mcp']), { command: 'mcp', args: [] });
});

test('skills lists the skills, and with a request says which that request would get', () => {
  assert.deepEqual(resolveCommand(['skills']), { command: 'skills:list', args: [] });
  assert.deepEqual(resolveCommand(['skills', 'Build a landing page']), { command: 'skills:check', args: ['Build a landing page'] });
});

test('every everyday command is a single word', () => {
  for (const entry of WORDS) assert.match(entry.word, /^[a-z]+$/, entry.word);
  assert.equal(new Set(WORDS.map(entry => entry.word)).size, WORDS.length, 'no word is used twice');
});

test('the app lists the same words after a slash, each with one line', () => {
  const menu = slashMenu();
  assert.ok(menu.some(item => item.label === '/run'));
  assert.ok(menu.some(item => item.label === '/memory'));
  for (const item of menu) {
    assert.match(item.label, /^\/[a-z]+$/);
    assert.ok(item.about.length > 0 && item.about.length <= 60, item.label);
  }
});

test('the older engine keeps its two-word commands', () => {
  assert.deepEqual(resolveCommand(['task', 'show', 'T-1']), { command: 'task:show', args: ['T-1'] });
  assert.deepEqual(resolveCommand(['project', 'settings', 'set', 'P-1', 's.json']), { command: 'project:settings:set', args: ['P-1', 's.json'] });
  assert.deepEqual(resolveCommand(['deployment', 'oci', 'check']), { command: 'deployment:oci:check', args: [] });
  assert.equal(resolveCommand(['task']).command, 'help');
});

test('no command, help and --help all ask for help; an unknown word is passed on to be refused', () => {
  for (const argv of [[], ['help'], ['--help'], ['-h']]) assert.equal(resolveCommand(argv).command, 'help', argv.join(' '));
  assert.equal(resolveCommand(['nonsense']).command, 'nonsense');
});

test('a slash copied from the app and the old internal names still work', () => {
  assert.deepEqual(resolveCommand(['/memory', 'a.ts']), { command: 'memory:show', args: ['a.ts'] });
  assert.deepEqual(resolveCommand(['memory:sync', '--check']), { command: 'memory:sync', args: ['--check'] });
});

test('a request that looks like a command is passed to the agent untouched', () => {
  assert.deepEqual(resolveCommand(['run', 'codex', '/memory', 'clean']), { command: 'agents:run', args: ['codex', '/memory', 'clean'] });
});

test('messages show commands the way they are typed', () => {
  assert.equal(shown('memory:accept'), 'acp accept');
  assert.equal(shown('agents:run'), 'acp run');
  assert.equal(shown('memory:sync'), 'acp sync');
  assert.equal(shown('task:show'), 'acp task show');
});

test('acp is installed as a command of its own', { skip: !built }, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(main), '..', '..', '..', 'package.json'), 'utf8'));
  assert.equal(manifest.bin.acp, 'dist/src/cli/main.js');
  assert.ok(fs.readFileSync(main, 'utf8').startsWith('#!/usr/bin/env node'), 'the built file says how to run itself');
});
