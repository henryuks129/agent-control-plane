// Writes a short summary of project memory into the files agents already
// read: AGENTS.md (Codex, OpenCode and others) and CLAUDE.md (Claude Code).
// See ADR-0008 §9g.
//
// Why: an agent started outside ACP, with no ACP server, still gets the
// project's memory. `.acp/` stays the source; these files are a generated
// copy of a summary.
//
// The promise this file keeps: ACP changes only its own marked block. Every
// other byte of AGENTS.md and CLAUDE.md belongs to the user.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectMemory, type ProjectMemory } from './store.js';

export type BlockStatus = 'created' | 'updated' | 'unchanged' | 'conflict';

export interface SyncReport {
  agents: BlockStatus;
  claude: 'created' | 'updated' | 'unchanged';
  /** True when the knowledge was too long for the summary and was cut. */
  truncated: boolean;
  /** Reasons nothing (or not everything) was written. Empty means all good. */
  problems: string[];
}

/**
 * Agents load these files into every session, so each byte costs context on
 * every task. Codex stops reading project instructions at 32 KiB by default;
 * 8 KB leaves most of that for the user's own text.
 */
export const ROOT_BLOCK_BUDGET_BYTES = 8192;

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

/** Builds the text that goes inside the block: knowledge plus an index of rules. */
export function buildSummary(memory: ProjectMemory, budgetBytes = ROOT_BLOCK_BUDGET_BYTES): { text: string; truncated: boolean } {
  const head = '## Project memory (managed by ACP)';

  // Rule bodies are left out. Listing every rule in full would load all of
  // them into every session; an index lets the agent open only the ones that
  // apply to the files it is changing.
  const ruleLines = memory.rules.map(rule => {
    const where = rule.paths.length ? `applies to \`${rule.paths.join('`, `')}\`` : 'applies when relevant';
    return `- \`${rule.name}\` ${where} (.acp/rules/${rule.name}.md)`;
  });
  const rulesPart = ruleLines.length
    ? ['### Rules for specific paths', 'Before changing a file, read the rules that apply to it. If two disagree, the narrower path wins.', ...ruleLines].join('\n')
    : '';

  const cutNote = 'Knowledge was cut to fit. Full text: .acp/knowledge.md';
  const join = (parts: string[]) => parts.filter(Boolean).join('\n\n');

  const full = join([head, memory.knowledge.trim(), rulesPart]);
  if (bytes(full) <= budgetBytes) return { text: full, truncated: false };

  // Over budget: keep whole paragraphs from the top until the next would not
  // fit. A paragraph cut in the middle can change its meaning.
  const paragraphs = memory.knowledge.trim().split(/\n{2,}/).map(paragraph => paragraph.trimEnd());
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    if (bytes(join([head, ...kept, paragraph, cutNote, rulesPart])) > budgetBytes) break;
    kept.push(paragraph);
  }
  return { text: join([head, ...kept, cutNote, rulesPart]), truncated: true };
}

// The block records a hash of what ACP wrote. If the text inside no longer
// matches the hash, a person edited it, and ACP must not overwrite that edit.
const BLOCK = /<!-- acp:begin sha256=([0-9a-f]{12})[^>]*-->\n([\s\S]*?)\n<!-- acp:end -->/;

function hashOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

function renderBlock(summary: string): string {
  return [
    `<!-- acp:begin sha256=${hashOf(summary)} generated from .acp/ by ACP; edit the files in .acp/ instead of this block -->`,
    summary,
    '<!-- acp:end -->',
  ].join('\n');
}

/** Returns the new contents of AGENTS.md, without writing anything. */
export function syncBlock(existing: string | null, summary: string): { text: string; status: BlockStatus } {
  const block = renderBlock(summary);
  if (existing === null) return { text: `${block}\n`, status: 'created' };

  const found = BLOCK.exec(existing);
  if (!found) {
    const gap = existing === '' ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    return { text: `${existing}${gap}${block}\n`, status: 'updated' };
  }

  const [whole, recordedHash, inner] = found;
  if (hashOf(inner) !== recordedHash) return { text: existing, status: 'conflict' };
  if (inner === summary) return { text: existing, status: 'unchanged' };

  // A replacer function, so "$" in the summary is not read as a pattern.
  return { text: existing.replace(whole, () => block), status: 'updated' };
}

/**
 * Claude Code reads CLAUDE.md, not AGENTS.md. One import line makes it read
 * both, which avoids keeping two copies of the summary in step.
 */
export function ensureClaudeImport(existing: string | null): { text: string; changed: boolean } {
  if (existing === null) return { text: '@AGENTS.md\n', changed: true };
  if (/AGENTS\.md/.test(existing)) return { text: existing, changed: false };
  const gap = existing === '' ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  return { text: `${existing}${gap}@AGENTS.md\n`, changed: true };
}

// Memory is committed to Git and copied into every agent's context, so a
// secret in it would spread widely (AGENTS.md rule 11). These patterns catch
// the common shapes; they are a safety net, not proof that text is clean.
const SPECIFIC_SECRETS: Array<[string, RegExp]> = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['NVIDIA key', /\bnvapi-[A-Za-z0-9_-]{20,}/],
  ['API key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
];
const ASSIGNED_SECRET = /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{16,}/i;

/** Names the kinds of secret that `text` appears to contain. */
export function findSecrets(text: string): string[] {
  const found = SPECIFIC_SECRETS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
  if (found.length > 0) return found;
  return ASSIGNED_SECRET.test(text) ? ['assigned secret'] : [];
}

function readOrNull(file: string): string | null {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

/**
 * Brings AGENTS.md and CLAUDE.md in line with `.acp/`.
 *
 * With `check: true` nothing is written; the report says what would change.
 * CI uses that to fail a pull request whose block is out of date or was
 * edited by hand.
 */
export function syncProject(root: string, options: { check?: boolean } = {}): SyncReport {
  const memory = loadProjectMemory(root);
  const report: SyncReport = { agents: 'unchanged', claude: 'unchanged', truncated: false, problems: [] };

  // Check before anything is written, so a secret never leaves `.acp/`.
  for (const kind of findSecrets(memory.knowledge)) report.problems.push(`${kind} found in .acp/knowledge.md. Remove it, then sync again.`);
  for (const rule of memory.rules) {
    for (const kind of findSecrets(`${rule.body}\n${rule.check ?? ''}`)) report.problems.push(`${kind} found in .acp/rules/${rule.name}.md. Remove it, then sync again.`);
  }
  if (report.problems.length > 0) return report;

  // Nothing to share yet. Do not add an empty block to someone's AGENTS.md.
  if (!memory.knowledge && memory.rules.length === 0) return report;

  const summary = buildSummary(memory);
  report.truncated = summary.truncated;

  const agentsPath = path.join(root, 'AGENTS.md');
  const agents = syncBlock(readOrNull(agentsPath), summary.text);
  report.agents = agents.status;
  if (agents.status === 'conflict') {
    report.problems.push('AGENTS.md: the ACP block was edited by hand. Move that edit into .acp/, restore the block, then sync again.');
  } else if (agents.status !== 'unchanged' && !options.check) {
    fs.writeFileSync(agentsPath, agents.text);
  }

  const claudePath = path.join(root, 'CLAUDE.md');
  const before = readOrNull(claudePath);
  const claude = ensureClaudeImport(before);
  if (claude.changed) {
    report.claude = before === null ? 'created' : 'updated';
    if (!options.check) fs.writeFileSync(claudePath, claude.text);
  }

  return report;
}
