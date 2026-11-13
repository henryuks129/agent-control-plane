// Memory that agents write while they work: proposed rules and checkpoints.
//
// Both live in `.acp/local/`, which Git ignores. That is deliberate:
//   - A proposed rule is not a rule. An agent may suggest one; only the user
//     can make it apply, by accepting it into `.acp/rules/`.
//   - Checkpoints change constantly and describe one task, so they do not
//     belong in the project's history.
// Everything is scanned for secrets before it is written (AGENTS.md rule 11).

import fs from 'node:fs';
import path from 'node:path';
import { findSecrets } from './agents-file.js';
import { parseRule } from './rules.js';

// AGENTS.md rule 5: checkpoints must be compact. A few hundred words is
// enough to resume from; more means the agent is pasting its whole chat.
export const CHECKPOINT_LIMIT_BYTES = 4096;

/** Turns any text into a safe file name, so a name can never point outside its folder. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
}

function refuseSecrets(text: string): void {
  const found = findSecrets(text);
  if (found.length) throw new Error(`This looks like it contains a secret (${found.join(', ')}). Nothing was saved. Remove it and try again.`);
}

const proposalsDir = (root: string) => path.join(root, '.acp', 'local', 'proposals');
const checkpointsDir = (root: string) => path.join(root, '.acp', 'local', 'checkpoints');

// A header value sits on one line, so anything that could start a new line
// or close the list is removed.
const oneLine = (value: string) => value.replace(/[\r\n\[\],]+/g, ' ').trim();

export interface RuleProposal {
  name: string;
  paths: string[];
  keywords?: string[];
  learnedFrom?: string;
  body: string;
}

/** Saves a rule for the user to look at. Returns its file name without `.md`. */
export function proposeRule(root: string, proposal: RuleProposal): string {
  const name = slug(proposal.name);
  const header = [
    `paths: [${proposal.paths.map(oneLine).filter(Boolean).join(', ')}]`,
    ...(proposal.keywords?.length ? [`keywords: [${proposal.keywords.map(oneLine).filter(Boolean).join(', ')}]`] : []),
    ...(proposal.learnedFrom ? [`learned-from: ${oneLine(proposal.learnedFrom)}`] : []),
  ];
  const text = `---\n${header.join('\n')}\n---\n${proposal.body.trim()}\n`;
  refuseSecrets(text);
  fs.mkdirSync(proposalsDir(root), { recursive: true });
  fs.writeFileSync(path.join(proposalsDir(root), `${name}.md`), text);
  return name;
}

export function listProposals(root: string): Array<{ name: string; paths: string[]; body: string }> {
  if (!fs.existsSync(proposalsDir(root))) return [];
  return fs.readdirSync(proposalsDir(root)).filter(file => file.endsWith('.md')).sort().map(file => {
    const rule = parseRule(file, fs.readFileSync(path.join(proposalsDir(root), file), 'utf8'));
    return { name: rule.name, paths: rule.paths, body: rule.body };
  });
}

/** Moves a proposal into `.acp/rules/`, where it starts to apply. */
export function acceptProposal(root: string, name: string): void {
  const from = path.join(proposalsDir(root), `${slug(name)}.md`);
  if (!fs.existsSync(from)) throw new Error(`No proposed rule called "${name}".`);
  const to = path.join(root, '.acp', 'rules', `${slug(name)}.md`);
  // An existing rule was written or approved by a person. Replacing it is
  // their edit to make, not a side effect of accepting something else.
  if (fs.existsSync(to)) throw new Error(`A rule called "${slug(name)}" already exists. Edit .acp/rules/${slug(name)}.md by hand, or rename the proposal.`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

export interface Checkpoint {
  task: string;
  done: string;
  next: string;
  notes?: string;
}

export function writeCheckpoint(root: string, checkpoint: Checkpoint): string {
  const text = [
    `# Checkpoint: ${oneLine(checkpoint.task)}`,
    '', '## Done', checkpoint.done.trim(),
    '', '## Next', checkpoint.next.trim(),
    ...(checkpoint.notes?.trim() ? ['', '## Notes', checkpoint.notes.trim()] : []),
    '',
  ].join('\n');
  if (Buffer.byteLength(text) > CHECKPOINT_LIMIT_BYTES) throw new Error(`This checkpoint is too long (${Buffer.byteLength(text)} bytes; the limit is ${CHECKPOINT_LIMIT_BYTES}). Keep what the next agent needs to continue and leave out the rest.`);
  refuseSecrets(text);
  fs.mkdirSync(checkpointsDir(root), { recursive: true });
  // One file per task, replaced each time: the latest state is what a
  // resuming agent needs, and Git already holds the history of the code.
  fs.writeFileSync(path.join(checkpointsDir(root), `${slug(checkpoint.task)}.md`), text);
  return slug(checkpoint.task);
}

export function readCheckpoint(root: string, task: string): string | null {
  const file = path.join(checkpointsDir(root), `${slug(task)}.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}
