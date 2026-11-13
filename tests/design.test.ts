import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { detectDesignTask } from '../src/design/detect.js';
import { attachSkills, catalogDir, loadCatalog, loadDesignSetting, selectSkills, skillsNote, treeDigest, type DesignSkill } from '../src/design/skills.js';
import { runDesignCommand } from '../src/design/cli.js';

// ---- Is this a design task? ----

test('a task that touches front-end files is a design task', () => {
  for (const file of ['src/app/page.tsx', 'web/styles/main.css', 'site/index.html', 'ui/Card.vue', 'ui/Card.svelte', 'app/Button.jsx', 'tailwind.config.ts', 'src/theme.ts']) {
    assert.equal(detectDesignTask({ files: [file], request: 'Fix it' }).design, true, file);
  }
});

test('a request for a page, screen, component or visual work is a design task', () => {
  for (const request of ['Build a landing page for the product', 'Add a settings screen', 'Make a Button component', 'Redesign the dashboard', 'Animate the hero section', 'Improve the UI spacing']) {
    assert.equal(detectDesignTask({ files: [], request }).design, true, request);
  }
});

test('back-end work is not a design task, even when it uses the word "design"', () => {
  for (const request of ['Design the database schema for orders', 'Fix the pagination bug in the API', 'Add an endpoint that lists users', 'Speed up the build']) {
    assert.equal(detectDesignTask({ files: ['src/api/orders.ts'], request }).design, false, request);
  }
});

test('the reasons say what made it a design task', () => {
  const found = detectDesignTask({ files: ['src/api/a.ts', 'web/main.css'], request: 'Build a landing page' });
  assert.deepEqual(found.reasons, ['file web/main.css', 'request mentions "landing page"']);
});

// ---- The skills ACP ships ----

test('every shipped skill is pinned to a commit, has a licence file, and matches its recorded digest', () => {
  const catalog = loadCatalog();
  assert.deepEqual(catalog.map(skill => skill.name), ['impeccable', 'huashu-design', 'awwwards']);
  for (const skill of catalog) {
    const dir = path.join(catalogDir(), skill.name);
    assert.match(skill.commit, /^[0-9a-f]{40}$/, `${skill.name} is pinned to a full commit`);
    assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')), `${skill.name} has its instructions`);
    assert.ok(fs.existsSync(path.join(dir, 'LICENSE')), `${skill.name} keeps its licence`);
    // A changed file without a new digest means the skill was edited without review.
    assert.equal(treeDigest(dir), skill.digest, `${skill.name} matches the reviewed copy`);
  }
  assert.ok(fs.existsSync(path.join(catalogDir(), 'impeccable/NOTICE.md')), 'Apache-2.0 requires keeping the NOTICE');
});

test('shipped skills hold instructions only: no scripts, programs or media', () => {
  const allowed = new Set(['.md', '']);
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  for (const skill of loadCatalog()) {
    for (const file of walk(path.join(catalogDir(), skill.name))) {
      assert.ok(allowed.has(path.extname(file)), `${file} is not an instruction file`);
      assert.equal(fs.statSync(file).mode & 0o111, 0, `${file} must not be executable`);
    }
  }
});

test('the digest changes when a file changes, is added, or is renamed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-digest-'));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'one');
  const first = treeDigest(dir);
  assert.equal(treeDigest(dir), first);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'two');
  const edited = treeDigest(dir);
  assert.notEqual(edited, first);
  fs.renameSync(path.join(dir, 'SKILL.md'), path.join(dir, 'OTHER.md'));
  assert.notEqual(treeDigest(dir), edited);
});

// ---- Which skills a task gets ----

const skill = (name: string, role: DesignSkill['role'], keywords: string[] = []): DesignSkill =>
  ({ name, role, keywords, repository: 'x/y', commit: 'a'.repeat(40), licence: 'MIT', source: '.', summary: `${name} summary`, digest: '' });
const CATALOG = [skill('impeccable', 'default'), skill('huashu-design', 'on-request', ['prototype', 'animation']), skill('awwwards', 'on-request', ['website', 'landing page'])];

test('the default skill always applies; the others only when the request asks for their kind of work', () => {
  assert.deepEqual(selectSkills(CATALOG, 'Fix the button spacing').map(s => s.name), ['impeccable']);
  assert.deepEqual(selectSkills(CATALOG, 'Build a landing page').map(s => s.name), ['impeccable', 'awwwards']);
  assert.deepEqual(selectSkills(CATALOG, 'Make an animation prototype').map(s => s.name), ['impeccable', 'huashu-design']);
});

test('a project can turn design skills off or choose exactly which apply', () => {
  assert.deepEqual(selectSkills(CATALOG, 'Build a landing page', false), []);
  assert.deepEqual(selectSkills(CATALOG, 'Fix the button', ['awwwards']).map(s => s.name), ['awwwards']);
});

test('the project setting is read from .acp/settings.json and is optional', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-setting-'));
  assert.equal(loadDesignSetting(root), undefined);
  fs.mkdirSync(path.join(root, '.acp'));
  fs.writeFileSync(path.join(root, '.acp/settings.json'), JSON.stringify({ designSkills: false }));
  assert.equal(loadDesignSetting(root), false);
  fs.writeFileSync(path.join(root, '.acp/settings.json'), JSON.stringify({ designSkills: ['impeccable'] }));
  assert.deepEqual(loadDesignSetting(root), ['impeccable']);
  fs.writeFileSync(path.join(root, '.acp/settings.json'), 'not json');
  assert.throws(() => loadDesignSetting(root), /\.acp\/settings\.json/);
});

// ---- Putting skills where agents read them ----

function tempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-design-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(root, 'README.md'), 'hello\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return root;
}

function tempCatalog(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-catalog-'));
  for (const name of ['impeccable', 'awwwards']) {
    fs.mkdirSync(path.join(dir, name, 'reference'), { recursive: true });
    fs.writeFileSync(path.join(dir, name, 'SKILL.md'), `# ${name}`);
    fs.writeFileSync(path.join(dir, name, 'reference/craft.md'), 'craft');
  }
  return dir;
}

test('skills are copied into the folders agents read, and Git never sees them', async () => {
  const repo = tempRepo();
  const report = await attachSkills(repo, [CATALOG[0], CATALOG[2]], tempCatalog());
  assert.deepEqual(report, { attached: ['impeccable', 'awwwards'], skipped: [] });
  for (const folder of ['.claude/skills', '.agents/skills']) {
    assert.equal(fs.readFileSync(path.join(repo, folder, 'impeccable/SKILL.md'), 'utf8'), '# impeccable');
    assert.equal(fs.readFileSync(path.join(repo, folder, 'awwwards/reference/craft.md'), 'utf8'), 'craft');
  }
  assert.equal(execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: repo, encoding: 'utf8' }), '', 'nothing to commit');
});

test('attaching twice does not repeat the ignore lines', async () => {
  const repo = tempRepo();
  const catalog = tempCatalog();
  await attachSkills(repo, [CATALOG[0]], catalog);
  await attachSkills(repo, [CATALOG[0]], catalog);
  const exclude = fs.readFileSync(path.join(repo, '.git/info/exclude'), 'utf8');
  assert.equal(exclude.split('\n').filter(line => line === '/.claude/skills/impeccable/').length, 1);
});

test("a skill the project already has under the same name is left alone", async () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, '.claude/skills/impeccable'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude/skills/impeccable/SKILL.md'), 'the project’s own');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'own skill'], { cwd: repo });
  const report = await attachSkills(repo, [CATALOG[0]], tempCatalog());
  assert.deepEqual(report, { attached: [], skipped: ['impeccable'] });
  assert.equal(fs.readFileSync(path.join(repo, '.claude/skills/impeccable/SKILL.md'), 'utf8'), 'the project’s own');
  assert.equal(fs.existsSync(path.join(repo, '.agents/skills/impeccable')), false);
});

test('the note tells the agent to use the skills without being asked, and that helper scripts are absent', () => {
  const note = skillsNote([CATALOG[0], CATALOG[2]]);
  assert.match(note, /^# Design skills\n/);
  assert.match(note, /impeccable: impeccable summary/);
  assert.match(note, /awwwards: awwwards summary/);
  assert.match(note, /\.claude\/skills.*\.agents\/skills/);
  assert.match(note, /scripts .* not included/i);
  assert.equal(skillsNote([]), '');
});

// ---- Commands ----

test('skills:list shows each skill, where it came from and its licence', () => {
  const result = runDesignCommand('skills:list', [], { root: process.cwd() });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /impeccable\s+always\s+Apache-2\.0\s+pbakaus\/impeccable@[0-9a-f]{12}/);
  assert.match(result.output, /awwwards\s+when asked\s+MIT\s+juliobsz\/skills@[0-9a-f]{12}/);
});

test('skills:check says which skills a request would get, and why', () => {
  const design = runDesignCommand('skills:check', ['--files', 'web/main.css', 'Build a landing page'], { root: os.tmpdir() });
  assert.match(design.output, /Design task: yes \(file web\/main\.css; request mentions "landing page"\)/);
  assert.match(design.output, /Skills: impeccable, awwwards/);
  const other = runDesignCommand('skills:check', ['Add an endpoint'], { root: os.tmpdir() });
  assert.match(other.output, /Design task: no/);
  assert.match(other.output, /Skills: none/);
});
