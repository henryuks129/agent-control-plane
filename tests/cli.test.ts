import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCommand, shown } from '../src/cli/command.js';

// These tests start the real command, the way a user or an agent's MCP
// client does. They need the built file, so they are skipped when the tests
// run straight from the TypeScript sources.
const main = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'main.js');
const built = fs.existsSync(main);
const acp = (args: string[], options: { input?: string; cwd?: string } = {}) =>
  spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', input: options.input, cwd: options.cwd ?? os.tmpdir() });

test('commands that do not use the database print no warning about it', { skip: !built }, () => {
  for (const command of [['/skills', 'list'], ['/memory', 'show', 'a.ts'], ['/runs', 'help']]) {
    const result = acp(command);
    assert.equal(result.stderr, '', command.join(' '));
  }
});

test('help lists the new commands', { skip: !built }, () => {
  const { stdout } = acp(['help']);
  for (const command of ['/mcp', '/runs list', '/runs clean', '/runs remove', '/design check', '/memory proposals', '/memory accept', '/run <agent>']) {
    assert.ok(stdout.includes(`\n  acp ${command}`), command);
  }
  assert.doesNotMatch(stdout, /^\s+(acp )?[a-z]+:[a-z]/m, 'no command is shown with a colon');
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

// How a typed command becomes the name the rest of ACP uses. Every command
// starts with a slash; the group and the action are separate words.
test('a command is a slash, a group and an action', () => {
  assert.deepEqual(resolveCommand(['/agents', 'list']), { command: 'agents:list', args: [] });
  assert.deepEqual(resolveCommand(['/memory', 'show', '--request', 'reset', 'a.ts']), { command: 'memory:show', args: ['--request', 'reset', 'a.ts'] });
  assert.deepEqual(resolveCommand(['/runs', 'remove', 'run-1', '--force']), { command: 'runs:remove', args: ['run-1', '--force'] });
  assert.deepEqual(resolveCommand(['/design', 'check', 'a.html']), { command: 'design:check', args: ['a.html'] });
});

test('commands with one word or three words resolve too', () => {
  assert.deepEqual(resolveCommand(['/mcp']), { command: 'mcp', args: [] });
  assert.deepEqual(resolveCommand(['/doctor']), { command: 'doctor', args: [] });
  assert.deepEqual(resolveCommand(['/project', 'settings', 'P-1']), { command: 'project:settings', args: ['P-1'] });
  assert.deepEqual(resolveCommand(['/project', 'settings', 'set', 'P-1', 's.json']), { command: 'project:settings:set', args: ['P-1', 's.json'] });
  assert.deepEqual(resolveCommand(['/deployment', 'oci', 'check']), { command: 'deployment:oci:check', args: [] });
});

test('/run is the short way to run an agent', () => {
  assert.deepEqual(resolveCommand(['/run', 'codex', '--edit', 'Build a page']), { command: 'agents:run', args: ['codex', '--edit', 'Build a page'] });
  assert.deepEqual(resolveCommand(['/agents', 'run', 'codex', 'Why?']), { command: 'agents:run', args: ['codex', 'Why?'] });
});

test('a group on its own lists, and a wrong action asks that group for its help', () => {
  assert.deepEqual(resolveCommand(['/runs']), { command: 'runs:list', args: [] });
  assert.deepEqual(resolveCommand(['/agents']), { command: 'agents:list', args: [] });
  assert.deepEqual(resolveCommand(['/memory']), { command: 'memory:help', args: [] });
  assert.deepEqual(resolveCommand(['/memory', 'nope', 'x']), { command: 'memory:nope', args: ['x'] });
});

test('no command, /help and --help all ask for help; an unknown word is passed on to be refused', () => {
  for (const argv of [[], ['/help'], ['help'], ['--help'], ['-h']]) assert.equal(resolveCommand(argv).command, 'help', argv.join(' '));
  assert.equal(resolveCommand(['/nonsense']).command, 'nonsense');
});

// Shells differ: Git Bash on Windows rewrites a leading slash into a folder
// path before ACP sees it, and scripts written for the colon form exist.
test('the slash may be left out, a rewritten slash is undone, and the colon form still works', () => {
  assert.deepEqual(resolveCommand(['agents', 'list']), { command: 'agents:list', args: [] });
  assert.deepEqual(resolveCommand(['C:/Program Files/Git/agents', 'list']), { command: 'agents:list', args: [] });
  assert.deepEqual(resolveCommand(['C:\\Program Files\\Git\\run', 'codex', 'Why?']), { command: 'agents:run', args: ['codex', 'Why?'] });
  assert.deepEqual(resolveCommand(['memory:sync', '--check']), { command: 'memory:sync', args: ['--check'] });
});

test('a request that looks like a path is never mistaken for a command', () => {
  assert.deepEqual(resolveCommand(['/run', 'codex', '/memory', 'show']), { command: 'agents:run', args: ['codex', '/memory', 'show'] });
});

test('messages show commands the way they are typed', () => {
  assert.equal(shown('memory:accept'), 'acp /memory accept');
  assert.equal(shown('agents:run'), 'acp /run');
  assert.equal(shown('mcp'), 'acp /mcp');
});

test('acp is installed as a command of its own', { skip: !built }, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(main), '..', '..', '..', 'package.json'), 'utf8'));
  assert.equal(manifest.bin.acp, 'dist/src/cli/main.js');
  assert.ok(fs.readFileSync(main, 'utf8').startsWith('#!/usr/bin/env node'), 'the built file says how to run itself');
});
