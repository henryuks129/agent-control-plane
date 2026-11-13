// Decides which memory one task receives (ADR-0008 §9g, §9l).
//
// Context is pull-based (AGENTS.md rule 2): an agent gets its own layer
// stack, not every rule the project has ever written. This file is also the
// "mistake guard": before a task starts, it picks the few rules that are
// relevant to the files and the request.
//
// Matching uses paths and keywords only. No model is called, so the result
// costs nothing and is the same every time for the same input.

import { matchesPath, specificity } from './match.js';
import type { Rule } from './rules.js';
import type { ProjectMemory } from './store.js';

export type Layer = 'user' | 'project' | 'rule' | 'task';

export interface MemorySection {
  layer: Layer;
  title: string;
  content: string;
  /** Present for rule sections, so callers can show where a rule came from. */
  rule?: Rule;
}

export interface MemoryBundle {
  /** Ordered from broadest to narrowest. */
  sections: MemorySection[];
  /** Relevant rules that did not fit the budget. The agent can ask for them by name. */
  omittedRules: string[];
}

export interface ResolveInput {
  project: ProjectMemory;
  /** The user layer, if any. */
  user?: string;
  /** Files the task will touch, relative to the repository root. */
  files: string[];
  /** What the user asked for. Used to match rule keywords. */
  request?: string;
  /** The task's latest checkpoint, already written as text. */
  checkpoint?: string;
  ruleBudgetBytes?: number;
}

/**
 * Rules load into every matching task, so they share a small budget.
 * 2 KB keeps the guard to a handful of rules (ADR-0008 §9l).
 */
export const DEFAULT_RULE_BUDGET_BYTES = 2048;

interface Candidate {
  rule: Rule;
  /** -1 when no path matched and the rule is here because of a keyword. */
  pathScore: number;
  keywordHits: number;
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? []);
}

function findCandidates(rules: Rule[], files: string[], request: string): Candidate[] {
  const requestWords = words(request);
  const candidates: Candidate[] = [];
  for (const rule of rules) {
    let pathScore = -1;
    for (const pattern of rule.paths) {
      if (files.some(file => matchesPath(pattern, file))) {
        pathScore = Math.max(pathScore, specificity(pattern));
      }
    }
    // Whole words only: a rule about "pass" must not fire on "password".
    const keywordHits = rule.keywords.filter(keyword => requestWords.has(keyword)).length;
    if (pathScore >= 0 || keywordHits > 0) candidates.push({ rule, pathScore, keywordHits });
  }
  return candidates;
}

/** Most relevant first. Decides what survives when the budget is tight. */
function byRelevance(a: Candidate, b: Candidate): number {
  return (
    b.pathScore - a.pathScore ||
    b.keywordHits - a.keywordHits ||
    // A rule learned from a real mistake outranks general guidance.
    Number(Boolean(b.rule.learnedFrom)) - Number(Boolean(a.rule.learnedFrom)) ||
    a.rule.name.localeCompare(b.rule.name)
  );
}

export function resolveMemory(input: ResolveInput): MemoryBundle {
  const budget = input.ruleBudgetBytes ?? DEFAULT_RULE_BUDGET_BYTES;
  const ranked = findCandidates(input.project.rules, input.files, input.request ?? '').sort(byRelevance);

  const kept: Candidate[] = [];
  const omittedRules: string[] = [];
  let used = 0;
  for (const candidate of ranked) {
    const size = Buffer.byteLength(candidate.rule.body, 'utf8');
    // A rule is kept whole or left out. Half a rule can say the opposite of
    // the full one ("never do X" cut before "unless Y").
    if (used + size <= budget) { kept.push(candidate); used += size; }
    else omittedRules.push(candidate.rule.name);
  }

  const sections: MemorySection[] = [];
  if (input.user?.trim()) sections.push({ layer: 'user', title: 'You', content: input.user.trim() });
  if (input.project.knowledge.trim()) sections.push({ layer: 'project', title: 'Project', content: input.project.knowledge.trim() });

  // Shown broadest first: when two layers disagree the narrower one wins, and
  // putting it last also places it nearest to the task in the agent's context.
  for (const candidate of [...kept].reverse()) {
    sections.push({ layer: 'rule', title: candidate.rule.name, content: candidate.rule.body, rule: candidate.rule });
  }

  if (input.checkpoint?.trim()) sections.push({ layer: 'task', title: 'Task progress', content: input.checkpoint.trim() });

  return { sections, omittedRules: omittedRules.sort() };
}

/** Turns a bundle into the text an agent reads. */
export function renderBundle(bundle: MemoryBundle): string {
  if (bundle.sections.length === 0 && bundle.omittedRules.length === 0) return '';

  const parts: string[] = [
    '# ACP memory',
    'Layers run from broadest to narrowest. If two disagree, the narrower (later) one wins.',
  ];
  for (const section of bundle.sections) {
    if (section.layer === 'rule') {
      const rule = section.rule;
      const paths = rule?.paths.length ? ` (${rule.paths.join(', ')})` : '';
      const lines = [`## Rule: ${section.title}${paths}`];
      if (rule?.learnedFrom) lines.push(`Past mistake (${rule.learnedFrom}). Do not repeat it.`);
      lines.push(section.content);
      // Tell the agent plainly whether this is enforced, so it does not
      // treat advice as a check or a check as optional.
      lines.push(rule?.check ? `This is checked by: \`${rule.check}\`` : 'Advice only; nothing checks this automatically.');
      parts.push(lines.join('\n'));
    } else {
      parts.push(`## ${section.title}\n${section.content}`);
    }
  }
  if (bundle.omittedRules.length > 0) {
    parts.push(`Relevant rules not shown to save space: ${bundle.omittedRules.join(', ')}. Read them in .acp/rules/ if needed.`);
  }
  return parts.join('\n\n') + '\n';
}
