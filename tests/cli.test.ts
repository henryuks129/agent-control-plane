import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// These tests start the real command, the way a user or an agent's MCP
// client does. They need the built file, so they are skipped when the tests
// run straight from the TypeScript sources.
const main = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'main.js');
const built = fs.existsSync(main);
const acp = (args: string[], options: { input?: string; cwd?: string } = {}) =>
  spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', input: options.input, cwd: options.cwd ?? os.tmpdir() });

test('commands that do not use the database print no warning about it', { skip: !built }, () => {
  for (const command of [['skills:list'], ['memory:show', 'a.ts'], ['runs:help']]) {
    const result = acp(command);
    assert.equal(result.stderr, '', command.join(' '));
  }
});

test('help lists the new commands', { skip: !built }, () => {
  const { stdout } = acp(['help']);
  for (const command of ['mcp', 'runs:list', 'runs:clean', 'runs:remove', 'design:check', 'memory:proposals', 'memory:accept']) {
    assert.match(stdout, new RegExp(`^  ${command}\\b`, 'm'), command);
  }
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
