// The design skills ACP ships, and how they reach an agent (ADR-0008 §9k).
//
// A skill is a folder of instructions written by someone else. An agent
// follows it with the user's permissions, so ACP treats a skill like code:
//   - each one is copied into this repository at one reviewed commit;
//   - only instruction files are shipped, never scripts, programs or media;
//   - a digest of the files is recorded, so an unreviewed edit fails a test.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface DesignSkill {
  name: string;
  /** `owner/name` on GitHub. */
  repository: string;
  /** The full commit the shipped copy was taken from. */
  commit: string;
  /** The folder inside that repository. */
  source: string;
  licence: string;
  /** `default` applies to every design task; `on-request` needs a keyword. */
  role: 'default' | 'on-request';
  keywords: string[];
  /** One line for the agent and the user: what the skill is for. */
  summary: string;
  /** `treeDigest` of the shipped folder at review time. */
  digest: string;
  /** Where the files are, for a skill that is not one of the shipped ones. */
  dir?: string;
}

/** `false` turns design skills off; a list names exactly the skills to use. */
export type DesignSetting = boolean | string[] | undefined;

// The folders the supported agents already look in. Claude Code reads the
// first; Codex and OpenCode read the second.
const SKILL_FOLDERS = ['.claude/skills', '.agents/skills'];

// Left inside each folder ACP creates, so a later run can tell its own copy
// (safe to refresh) from a skill the project keeps under the same name.
const MARKER = '.acp-attached';

/** Where the shipped skills live. Found by walking up, so it works from `src/` and from `dist/`. */
export function catalogDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, 'design-library', 'skills');
    if (fs.existsSync(path.join(candidate, 'skills.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('The design skills (design-library/skills) are missing from this ACP installation.');
    dir = parent;
  }
}

export function loadCatalog(dir = catalogDir()): DesignSkill[] {
  return (JSON.parse(fs.readFileSync(path.join(dir, 'skills.json'), 'utf8')) as { skills: DesignSkill[] }).skills;
}

/**
 * A project's own skills: each folder in `.acp/skills/` that has a SKILL.md.
 * They are the project's files, committed and reviewed by its own people, so
 * ACP does not pin or digest them.
 */
export function loadProjectSkills(root: string): DesignSkill[] {
  const base = path.join(root, '.acp', 'skills');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'SKILL.md')))
    .map(entry => {
      const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(base, entry.name, 'SKILL.md'), 'utf8'))?.[1] ?? '';
      const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(header)?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
      const keywords = field('keywords').replace(/^\[|\]$/g, '').split(',').map(word => word.trim().toLowerCase()).filter(Boolean);
      return {
        name: entry.name,
        repository: 'this project',
        commit: '',
        source: `.acp/skills/${entry.name}`,
        licence: '-',
        // With no keywords the project wants it on every design task.
        role: keywords.length ? 'on-request' as const : 'default' as const,
        keywords,
        summary: field('description') || 'a skill kept in this project.',
        digest: '',
        dir: path.join(base, entry.name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every skill a task in this project can get. The project's own come first and win on a shared name. */
export function availableSkills(root: string, catalog = loadCatalog()): DesignSkill[] {
  const own = loadProjectSkills(root);
  return [...own, ...catalog.filter(skill => !own.some(mine => mine.name === skill.name))];
}

function filesUnder(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? filesUnder(path.join(dir, entry.name), base) : [path.relative(base, path.join(dir, entry.name))])
    .sort();
}

/** One hash for a whole folder: it covers every file's name and content. */
export function treeDigest(dir: string): string {
  const hash = createHash('sha256');
  for (const file of filesUnder(dir)) {
    // Forward slashes, so the digest is the same on Windows.
    hash.update(`${file.split(path.sep).join('/')}\0`);
    hash.update(fs.readFileSync(path.join(dir, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function selectSkills(catalog: DesignSkill[], request: string, setting?: DesignSetting): DesignSkill[] {
  if (setting === false) return [];
  if (Array.isArray(setting)) return catalog.filter(skill => setting.includes(skill.name));
  const text = request.toLowerCase();
  // Each extra skill costs the agent context, so the specialised ones are
  // added only when the request is about their kind of work.
  return catalog.filter(skill => skill.role === 'default' || skill.keywords.some(keyword => text.includes(keyword)));
}

export function loadDesignSetting(root: string): DesignSetting {
  const file = path.join(root, '.acp', 'settings.json');
  if (!fs.existsSync(file)) return undefined;
  try {
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as { designSkills?: DesignSetting }).designSkills;
  } catch (error) {
    throw new Error(`.acp/settings.json is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Copies skills into a worktree. Never the project folder: the user's own
 * files stay as they are, and the copies are hidden from Git so they cannot
 * end up in a commit or a pull request.
 */
export async function attachSkills(worktree: string, skills: DesignSkill[], dir = catalogDir()): Promise<{ attached: string[]; skipped: string[] }> {
  const attached: string[] = [];
  const skipped: string[] = [];
  const ignore: string[] = [];

  for (const skill of skills) {
    const targets = SKILL_FOLDERS.map(folder => path.join(worktree, folder, skill.name));
    // The project's own skill of the same name wins, in every folder, so
    // agents never see two different skills under one name.
    if (targets.some(target => fs.existsSync(target) && !fs.existsSync(path.join(target, MARKER)))) {
      skipped.push(skill.name);
      continue;
    }
    for (const target of targets) {
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(skill.dir ?? path.join(dir, skill.name), target, { recursive: true });
      fs.writeFileSync(path.join(target, MARKER), `${skill.repository}${skill.commit ? `@${skill.commit}` : ''}\n`);
    }
    ignore.push(...SKILL_FOLDERS.map(folder => `/${folder}/${skill.name}/`));
    attached.push(skill.name);
  }

  if (ignore.length) {
    // `info/exclude` is Git's ignore list that is itself never committed, so
    // nothing in the user's repository changes.
    const { stdout } = await exec('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: worktree });
    const file = path.resolve(worktree, stdout.trim());
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const missing = ignore.filter(line => !existing.split('\n').includes(line));
    if (missing.length) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
    }
  }
  return { attached, skipped };
}

/**
 * What the agent is told. This is what makes the skills work without the
 * user calling them: the agent is asked to follow them before it starts.
 */
export function skillsNote(skills: DesignSkill[]): string {
  if (skills.length === 0) return '';
  return [
    '# Design skills',
    `This is design work. Before changing anything, read and follow these skills. Each is a folder under ${SKILL_FOLDERS.join(' and ')} with a SKILL.md:`,
    ...skills.map(skill => `- ${skill.name}: ${skill.summary}`),
    'For the skills ACP ships, only the instructions are present. The helper scripts and programs they mention are not included: skip any step that needs one, and do not download them.',
    '',
  ].join('\n');
}
