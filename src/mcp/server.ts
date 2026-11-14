// ACP's MCP server (ADR-0008 §9e).
//
// MCP (Model Context Protocol) is how coding agents call outside tools.
// This server gives any agent that speaks it, whether ACP started it or the
// user did in a terminal, the same shared memory: read what applies, search
// it, propose a rule, and leave a checkpoint for whoever continues.
//
// It speaks the protocol's stdio form: one JSON-RPC message per line on
// standard input, one reply per line on standard output. That is small
// enough to write with Node's built-ins, so ACP adds no dependency for it.
//
// What it deliberately cannot do: change `.acp/knowledge.md` or
// `.acp/rules/`. Those are the project's agreed memory, and they change only
// when the user accepts a proposal.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { proposeRule, readCheckpoint, writeCheckpoint } from '../memory/local.js';
import { renderBundle, resolveMemory } from '../memory/resolve.js';
import { loadProjectMemory, loadUserMemory } from '../memory/store.js';

export interface McpContext {
  /** The project the agent is working in. */
  root: string;
  /** ACP's own storage, for the user layer of memory. */
  dataDir: string;
}

// Newest first. A client names the version it wants; the server agrees when
// it knows that version and otherwise offers its newest.
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Tool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  run(args: Record<string, unknown>, ctx: McpContext): string;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

function required(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`"${name}" is required and must be text.`);
  return value;
}

/** Each searchable memory file with the name an agent can open it by. */
function memoryFiles(ctx: McpContext): Array<{ label: string; text: string }> {
  const files: Array<{ label: string; text: string }> = [];
  const add = (label: string, file: string) => { if (fs.existsSync(file)) files.push({ label, text: fs.readFileSync(file, 'utf8') }); };
  add('.acp/knowledge.md', path.join(ctx.root, '.acp', 'knowledge.md'));
  const rules = path.join(ctx.root, '.acp', 'rules');
  if (fs.existsSync(rules)) for (const file of fs.readdirSync(rules).filter(name => name.endsWith('.md')).sort()) add(`.acp/rules/${file}`, path.join(rules, file));
  const user = loadUserMemory(ctx.dataDir);
  if (user) files.push({ label: 'your preferences', text: user });
  return files;
}

export const TOOLS: Tool[] = [
  {
    name: 'memory_get',
    description: "Read this project's shared memory before you start: the user's preferences, project rules and decisions, and the rules for the files you are about to change, including past mistakes made there. Narrower rules win over broader ones.",
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Paths you expect to read or change, relative to the project root.' },
        request: { type: 'string', description: 'What you were asked to do, in a sentence. Rules are also matched by its words.' },
      },
    },
    run(args, ctx) {
      const text = renderBundle(resolveMemory({
        project: loadProjectMemory(ctx.root),
        user: loadUserMemory(ctx.dataDir),
        files: strings(args.files),
        request: typeof args.request === 'string' ? args.request : '',
      }));
      return text || 'This project has no ACP memory yet.';
    },
  },
  {
    name: 'memory_search',
    description: 'Search the shared memory for a word or phrase, when you need a rule or decision that memory_get did not return. Returns matching lines with the file and line they are on.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'A word or phrase. Case does not matter.' } }, required: ['query'] },
    run(args, ctx) {
      const query = required(args, 'query').toLowerCase();
      const hits: string[] = [];
      for (const file of memoryFiles(ctx)) {
        file.text.split(/\r?\n/).forEach((line, index) => {
          if (line.toLowerCase().includes(query)) hits.push(`${file.label}:${index + 1}: ${line.trim()}`);
        });
      }
      // Enough to answer the question without filling the agent's context.
      return hits.length ? hits.slice(0, 40).join('\n') : `Nothing in memory matches "${args.query}".`;
    },
  },
  {
    name: 'memory_propose_rule',
    description: 'Propose a rule for future work on certain files, for example after fixing a mistake that could be made again. It is saved for the user to review and does not apply until they accept it. Never include keys, passwords or tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A short name, for example "date-handling".' },
        paths: { type: 'array', items: { type: 'string' }, description: 'The files it applies to, as patterns such as "src/api/**".' },
        body: { type: 'string', description: 'The rule: what to do, and why, in a few sentences.' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Optional words that should also bring this rule up.' },
        learned_from: { type: 'string', description: 'Optional: the task or mistake this came from.' },
      },
      required: ['name', 'paths', 'body'],
    },
    run(args, ctx) {
      const paths = strings(args.paths);
      if (paths.length === 0) throw new Error('"paths" is required: name at least one file pattern the rule applies to.');
      const name = proposeRule(ctx.root, {
        name: required(args, 'name'),
        paths,
        body: required(args, 'body'),
        keywords: strings(args.keywords),
        learnedFrom: typeof args.learned_from === 'string' ? args.learned_from : undefined,
      });
      return `Saved as a proposal. It does not apply yet. Tell the user they can accept it with: acp /memory accept ${name}`;
    },
  },
  {
    name: 'checkpoint_write',
    description: 'Save where a task stands so that you, or another agent, can continue it later without the whole conversation. Write it when you finish a step or are about to stop. Keep it short. Never include keys, passwords or tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'A short name for the task. Use the same name every time.' },
        done: { type: 'string', description: 'What is finished and verified.' },
        next: { type: 'string', description: 'The next step, specific enough to start on.' },
        notes: { type: 'string', description: 'Optional: decisions made, things tried that failed, files that matter.' },
      },
      required: ['task', 'done', 'next'],
    },
    run(args, ctx) {
      const name = writeCheckpoint(ctx.root, {
        task: required(args, 'task'),
        done: required(args, 'done'),
        next: required(args, 'next'),
        notes: typeof args.notes === 'string' ? args.notes : undefined,
      });
      return `Checkpoint saved for "${name}".`;
    },
  },
  {
    name: 'checkpoint_read',
    description: 'Read the latest checkpoint for a task, to continue work that you or another agent started.',
    inputSchema: { type: 'object', properties: { task: { type: 'string', description: 'The task name used when the checkpoint was written.' } }, required: ['task'] },
    run(args, ctx) {
      return readCheckpoint(ctx.root, required(args, 'task')) ?? `No checkpoint for "${args.task}" yet.`;
    },
  },
];

interface Message { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> }

/** Answers one message. Returns nothing for a notification, which expects no reply. */
export function handleMessage(message: Message, ctx: McpContext): object | undefined {
  // A message without an id is a notification. Replying to one is a protocol error.
  if (message.id === undefined || message.id === null) return undefined;
  const reply = (result: object) => ({ jsonrpc: '2.0', id: message.id, result });

  switch (message.method) {
    case 'initialize': {
      const asked = message.params?.protocolVersion;
      return reply({
        protocolVersion: typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'acp', title: 'Agent Control Plane', version: '0.3.1' },
        instructions: 'Shared memory for this project. Call memory_get before changing files. Write a checkpoint when you finish a step or stop.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find(candidate => candidate.name === message.params?.name);
      try {
        if (!tool) throw new Error(`Unknown tool "${String(message.params?.name)}". Tools: ${TOOLS.map(candidate => candidate.name).join(', ')}`);
        const text = tool.run((message.params?.arguments ?? {}) as Record<string, unknown>, ctx);
        return reply({ content: [{ type: 'text', text }] });
      } catch (error) {
        // A tool failure is returned as a result marked isError, not as a
        // protocol error, so the agent reads the reason and can correct itself.
        return reply({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true });
      }
    }
    default:
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
  }
}

/** Runs the server until the input closes. */
export async function serve(input: Readable, output: Writable, ctx: McpContext): Promise<void> {
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let response: object | undefined;
    try {
      response = handleMessage(JSON.parse(line) as Message, ctx);
    } catch {
      response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: each line must be one JSON message.' } };
    }
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}
