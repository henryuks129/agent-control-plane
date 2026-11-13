import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { handleMessage, serve, TOOLS, type McpContext } from '../src/mcp/server.js';
import { runMemoryCommand } from '../src/memory/cli.js';

function project(): McpContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-mcp-'));
  fs.mkdirSync(path.join(root, '.acp/rules'), { recursive: true });
  fs.writeFileSync(path.join(root, '.acp/knowledge.md'), '# Project knowledge\n\n## Rules\n- Use pnpm, never npm.\n- Money is stored in cents.\n');
  fs.writeFileSync(path.join(root, '.acp/rules/api.md'), '---\npaths: [src/api/**]\nkeywords: [endpoint]\n---\nValidate every request body.');
  return { root, dataDir: path.join(root, '.data') };
}

const call = (ctx: McpContext, name: string, args: Record<string, unknown>) =>
  handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx) as { result: { content: Array<{ type: string; text: string }>; isError?: boolean } };
const text = (response: ReturnType<typeof call>) => response.result.content[0].text;

// ---- The protocol ----

test('initialize answers with the server name, the tools capability and the version the client asked for', () => {
  const response = handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, project()) as any;
  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, '2025-03-26');
  assert.equal(response.result.serverInfo.name, 'acp');
  assert.deepEqual(response.result.capabilities, { tools: {} });
});

test('an unknown protocol version gets the newest one this server speaks', () => {
  const response = handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, project()) as any;
  assert.equal(response.result.protocolVersion, '2025-06-18');
});

test('notifications get no reply, ping gets an empty one, and an unknown method is an error', () => {
  const ctx = project();
  assert.equal(handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx), undefined);
  assert.deepEqual(handleMessage({ jsonrpc: '2.0', id: 7, method: 'ping' }, ctx), { jsonrpc: '2.0', id: 7, result: {} });
  assert.equal((handleMessage({ jsonrpc: '2.0', id: 8, method: 'nope' }, ctx) as any).error.code, -32601);
});

test('tools/list describes every tool with a schema', () => {
  const response = handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, project()) as any;
  assert.deepEqual(response.result.tools.map((tool: { name: string }) => tool.name), ['memory_get', 'memory_search', 'memory_propose_rule', 'checkpoint_write', 'checkpoint_read']);
  for (const tool of response.result.tools) {
    assert.ok(tool.description.length > 20, tool.name);
    assert.equal(tool.inputSchema.type, 'object', tool.name);
  }
  assert.equal(TOOLS.length, 5);
});

test('calling an unknown tool, or leaving out a required value, is reported to the agent as an error result', () => {
  const ctx = project();
  assert.equal(call(ctx, 'nope', {}).result.isError, true);
  const missing = call(ctx, 'memory_search', {});
  assert.equal(missing.result.isError, true);
  assert.match(text(missing), /query/);
});

// ---- Reading memory ----

test('memory_get returns the project knowledge and only the rules that match the files', () => {
  const ctx = project();
  const api = text(call(ctx, 'memory_get', { files: ['src/api/users.ts'] }));
  assert.match(api, /Use pnpm/);
  assert.match(api, /Validate every request body/);
  assert.doesNotMatch(text(call(ctx, 'memory_get', { files: ['web/page.css'] })), /Validate every request body/);
  assert.match(text(call(ctx, 'memory_get', { request: 'add an endpoint' })), /Validate every request body/);
});

test('memory_search finds matching lines and says where each is from', () => {
  const ctx = project();
  const found = text(call(ctx, 'memory_search', { query: 'cents' }));
  assert.match(found, /\.acp\/knowledge\.md:5: - Money is stored in cents\./);
  assert.match(text(call(ctx, 'memory_search', { query: 'REQUEST BODY' })), /\.acp\/rules\/api\.md:5/);
  assert.match(text(call(ctx, 'memory_search', { query: 'kubernetes' })), /Nothing in memory matches/);
});

// ---- Writing memory ----

test('a proposed rule is saved for the user to accept and is not a rule yet', () => {
  const ctx = project();
  const reply = text(call(ctx, 'memory_propose_rule', { name: 'Date Handling!', paths: ['src/dates/**'], body: 'Store dates in UTC.', learned_from: 'task 12' }));
  assert.match(reply, /memory:accept date-handling/);
  const saved = fs.readFileSync(path.join(ctx.root, '.acp/local/proposals/date-handling.md'), 'utf8');
  assert.match(saved, /paths: \[src\/dates\/\*\*\]/);
  assert.match(saved, /learned-from: task 12/);
  assert.match(saved, /Store dates in UTC\./);
  assert.equal(fs.existsSync(path.join(ctx.root, '.acp/rules/date-handling.md')), false);
  assert.doesNotMatch(text(call(ctx, 'memory_get', { files: ['src/dates/a.ts'] })), /UTC/);
});

test('the user accepts a proposal with memory:accept, and only then do agents receive it', () => {
  const ctx = project();
  call(ctx, 'memory_propose_rule', { name: 'dates', paths: ['src/dates/**'], body: 'Store dates in UTC.' });
  assert.match(runMemoryCommand('memory:proposals', [], ctx).output, /dates\s+src\/dates\/\*\*/);
  const accepted = runMemoryCommand('memory:accept', ['dates'], ctx);
  assert.equal(accepted.exitCode, 0);
  assert.ok(fs.existsSync(path.join(ctx.root, '.acp/rules/dates.md')));
  assert.equal(fs.existsSync(path.join(ctx.root, '.acp/local/proposals/dates.md')), false);
  assert.match(text(call(ctx, 'memory_get', { files: ['src/dates/a.ts'] })), /Store dates in UTC/);
  assert.equal(runMemoryCommand('memory:accept', ['nope'], ctx).exitCode, 1);
  assert.equal(runMemoryCommand('memory:proposals', [], ctx).output, 'No proposed rules.');
});

test('memory:accept will not replace a rule that already exists', () => {
  const ctx = project();
  call(ctx, 'memory_propose_rule', { name: 'api', paths: ['src/api/**'], body: 'Something else.' });
  const result = runMemoryCommand('memory:accept', ['api'], ctx);
  assert.equal(result.exitCode, 1);
  assert.match(fs.readFileSync(path.join(ctx.root, '.acp/rules/api.md'), 'utf8'), /Validate every request body/);
});

test('a checkpoint is saved per task and read back by the next agent', () => {
  const ctx = project();
  assert.match(text(call(ctx, 'checkpoint_read', { task: 'checkout' })), /No checkpoint/);
  call(ctx, 'checkpoint_write', { task: 'Checkout flow', done: 'Cart totals fixed.', next: 'Wire the pay button.', notes: 'Tests in tests/cart.' });
  const read = text(call(ctx, 'checkpoint_read', { task: 'Checkout flow' }));
  assert.match(read, /Cart totals fixed\./);
  assert.match(read, /Wire the pay button\./);
  assert.ok(fs.existsSync(path.join(ctx.root, '.acp/local/checkpoints/checkout-flow.md')));
});

test('a checkpoint over the size limit is refused, because checkpoints must stay compact', () => {
  const reply = call(project(), 'checkpoint_write', { task: 't', done: 'x'.repeat(5000), next: 'y' });
  assert.equal(reply.result.isError, true);
  assert.match(text(reply), /too long/);
});

test('nothing that looks like a secret is written, in a checkpoint or a proposed rule', () => {
  const ctx = project();
  const secret = 'api_key = "sk-abcdefghijklmnopqrstuvwxyz123456"';
  const checkpoint = call(ctx, 'checkpoint_write', { task: 't', done: secret, next: 'n' });
  assert.equal(checkpoint.result.isError, true);
  assert.match(text(checkpoint), /secret/i);
  assert.equal(fs.existsSync(path.join(ctx.root, '.acp/local/checkpoints/t.md')), false);
  assert.equal(call(ctx, 'memory_propose_rule', { name: 'r', paths: ['a/**'], body: secret }).result.isError, true);
  assert.equal(fs.existsSync(path.join(ctx.root, '.acp/local/proposals/r.md')), false);
});

test('a task or rule name cannot be used to write outside the memory folders', () => {
  const ctx = project();
  call(ctx, 'checkpoint_write', { task: '../../escape', done: 'd', next: 'n' });
  assert.equal(fs.existsSync(path.join(ctx.root, 'escape.md')), false);
  assert.ok(fs.existsSync(path.join(ctx.root, '.acp/local/checkpoints/escape.md')));
});

// ---- Over a real stream ----

test('the server reads one JSON message per line and writes one JSON reply per line', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let received = '';
  output.on('data', chunk => { received += chunk; });
  const done = serve(input, output, project());
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`);
  input.write('this is not json\n');
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  await done;
  const replies = received.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(replies.map(reply => reply.id), [1, null, 2]);
  assert.equal(replies[1].error.code, -32700);
});
