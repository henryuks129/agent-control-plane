// Checks finished design work for known anti-patterns (ADR-0008 §9k).
//
// Skills ask an agent to do good work; this checks whether it did. Every
// rule is a plain pattern over the files, with no model call, so a finding
// is evidence: it names the file and line and can be confirmed by reading
// them (AGENTS.md rule 12). Taste is left to people and to reviewers whose
// comments are marked as opinion.
//
// A rule is only here if it rarely fires on careful work. A check that cries
// wolf gets ignored, and then it protects nothing.

import fs from 'node:fs';
import path from 'node:path';
import { isFrontEndFile } from './detect.js';

export interface DesignFinding {
  rule: string;
  file: string;
  line: number;
  /** The matching line, trimmed, so the finding can be confirmed at a glance. */
  evidence: string;
  /** What to do about it. */
  fix: string;
}

interface LineRule {
  rule: string;
  pattern: RegExp;
  fix: string;
  /** Skips the rule for a whole file, for example when a focus style exists elsewhere in it. */
  unless?: RegExp;
  /** Reports the first match only: the problem is the file, not each line. */
  once?: boolean;
}

const RULES: LineRule[] = [
  { rule: 'placeholder-text', pattern: /lorem ipsum/i, fix: 'Write the real copy.' },
  { rule: 'dead-link', pattern: /href=["'](#|javascript:[^"']*)?["']/i, fix: 'Point the link somewhere, or make it a button that does something.' },
  { rule: 'image-without-alt', pattern: /<img\b(?![^>]*\balt=)[^>]*>/i, fix: 'Add alt text, or alt="" if the image is decoration.' },
  { rule: 'gradient-text', pattern: /background-clip:\s*text/i, fix: 'Show emphasis with weight or size.' },
  { rule: 'hard-offset-shadow', pattern: /box-shadow:\s*-?[1-9]\d*px\s+-?[1-9]\d*px\s+0(px)?[\s,;}#a-z(]/i, fix: 'Give the shadow a blur, or remove it.' },
  { rule: 'side-stripe-border', pattern: /border-(left|right):\s*([2-9]|\d{2,})px\s+solid/i, fix: 'Use a full border, a background, or spacing to set the item apart.' },
  { rule: 'focus-outline-removed', pattern: /outline:\s*(none|0)\b/i, unless: /:focus-visible/, once: true, fix: 'Keep a visible focus style: add a :focus-visible rule.' },
  { rule: 'motion-without-reduced-motion', pattern: /@keyframes|animation(-name)?:\s*(?!none)/i, unless: /prefers-reduced-motion/, once: true, fix: 'Respect prefers-reduced-motion.' },
];

export function checkDesign(files: Array<{ path: string; content: string }>): DesignFinding[] {
  const findings: DesignFinding[] = [];
  for (const file of files) {
    if (!isFrontEndFile(file.path)) continue;
    const lines = file.content.split(/\r?\n/);
    for (const rule of RULES) {
      if (rule.unless?.test(file.content)) continue;
      for (let index = 0; index < lines.length; index++) {
        if (!rule.pattern.test(lines[index])) continue;
        // Long minified lines are cut so the report stays readable.
        findings.push({ rule: rule.rule, file: file.path, line: index + 1, evidence: lines[index].trim().slice(0, 160), fix: rule.fix });
        if (rule.once) break;
      }
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Checks files inside a folder. A file that no longer exists (the agent deleted it) is skipped. */
export function checkFiles(root: string, files: string[]): DesignFinding[] {
  return checkDesign(files
    .filter(file => isFrontEndFile(file) && fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile())
    .map(file => ({ path: file, content: fs.readFileSync(path.join(root, file), 'utf8') })));
}

/** The lines shown to the user. The heading says what kind of claim this is. */
export function renderFindings(findings: DesignFinding[]): string[] {
  if (findings.length === 0) return [];
  const width = Math.max(...findings.map(finding => `${finding.file}:${finding.line}`.length));
  return [
    `Design check: ${findings.length} finding${findings.length === 1 ? '' : 's'} (pattern matches in the files, not opinions)`,
    ...findings.map(finding => `  ${`${finding.file}:${finding.line}`.padEnd(width + 2)}${finding.rule}. ${finding.fix}`),
  ];
}
