// Where memory lives on disk (ADR-0008 §9g).
//
//   <project>/.acp/knowledge.md    project layer   committed to Git
//   <project>/.acp/rules/*.md      path rules      committed to Git
//   <project>/.acp/local/          checkpoints     ignored by Git
//   <ACP data dir>/memory/user.md  user layer      never in the project
//
// The project and rule layers are files in the repository on purpose: Git is
// the source of truth (AGENTS.md rule 3), changes are reviewed in pull
// requests, and the memory still works when ACP is not running.

import fs from 'node:fs';
import path from 'node:path';
import { parseRule, type Rule } from './rules.js';

export interface ProjectMemory {
  knowledge: string;
  rules: Rule[];
}

const KNOWLEDGE_TEMPLATE = `# Project knowledge

What stays true about this project. Every connected agent reads this.
Keep it short: goals, rules and decisions, not a history.

## Goals

## Rules

## Decisions
`;

// Checkpoints change constantly and can quote secrets from logs, so they
// must never be committed.
const LOCAL_IGNORE = '.acp/local/';

function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

/**
 * Sets up `.acp/` in a project. Returns what it created, relative to `root`.
 *
 * Safe to run again: it only adds what is missing and never rewrites a file a
 * person has already written.
 */
export function initProjectMemory(root: string): string[] {
  const created: string[] = [];

  const knowledge = path.join(root, '.acp', 'knowledge.md');
  if (!fs.existsSync(knowledge)) {
    fs.mkdirSync(path.dirname(knowledge), { recursive: true });
    fs.writeFileSync(knowledge, KNOWLEDGE_TEMPLATE);
    created.push('.acp/knowledge.md');
  }

  const rules = path.join(root, '.acp', 'rules');
  if (!fs.existsSync(rules)) {
    fs.mkdirSync(rules, { recursive: true });
    created.push('.acp/rules/');
  }

  const gitignore = path.join(root, '.gitignore');
  const current = readText(gitignore);
  const alreadyIgnored = current.split(/\r?\n/).some(line => line.trim() === LOCAL_IGNORE);
  if (!alreadyIgnored) {
    const separator = current === '' || current.endsWith('\n') ? '' : '\n';
    fs.writeFileSync(gitignore, `${current}${separator}${LOCAL_IGNORE}\n`);
    created.push('.gitignore');
  }

  return created;
}

/** Reads the project and rule layers. A project without `.acp/` is simply empty. */
export function loadProjectMemory(root: string): ProjectMemory {
  const knowledge = readText(path.join(root, '.acp', 'knowledge.md')).trim();

  const rulesDir = path.join(root, '.acp', 'rules');
  let files: string[] = [];
  try { files = fs.readdirSync(rulesDir); } catch { /* no rules yet */ }

  const rules = files
    .filter(file => file.toLowerCase().endsWith('.md'))
    .sort() // a stable order, so the same memory always renders the same text
    .map(file => parseRule(file, readText(path.join(rulesDir, file))));

  return { knowledge, rules };
}

/**
 * Reads the user layer: preferences that apply to every project.
 *
 * It lives in ACP's own storage, not the repository, because it belongs to
 * one person and teammates should not inherit it through Git.
 */
export function loadUserMemory(dataDir: string): string {
  return readText(path.join(dataDir, 'memory', 'user.md')).trim();
}
