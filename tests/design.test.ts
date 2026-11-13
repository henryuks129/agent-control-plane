import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { detectDesignTask } from '../src/design/detect.js';
import { attachSkills, availableSkills, catalogDir, loadCatalog, loadDesignSetting, loadProjectSkills, selectSkills, skillsNote, treeDigest, type DesignSkill } from '../src/design/skills.js';
import { checkDesign, checkFiles } from '../src/design/check.js';
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

// ---- A project's own skills ----

function projectWithSkill(front: string, name = 'house-style'): string {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, '.acp/skills', name, 'reference'), { recursive: true });
  fs.writeFileSync(path.join(root, '.acp/skills', name, 'SKILL.md'), `---\n${front}\n---\nUse our tokens.`);
  fs.writeFileSync(path.join(root, '.acp/skills', name, 'reference/tokens.md'), 'tokens');
  return root;
}

test('a folder in .acp/skills with a SKILL.md is a project skill, described by its own header', () => {
  const root = projectWithSkill('name: house-style\ndescription: Our tokens and components.');
  const [skill] = loadProjectSkills(root);
  assert.deepEqual([skill.name, skill.summary, skill.role, skill.repository], ['house-style', 'Our tokens and components.', 'default', 'this project']);
  assert.deepEqual(loadProjectSkills(tempRepo()), []);
});

test('a project skill with keywords applies only when the request mentions one', () => {
  const root = projectWithSkill('description: Email templates.\nkeywords: [email, newsletter]', 'emails');
  const skills = availableSkills(root, CATALOG);
  assert.deepEqual(selectSkills(skills, 'Fix the button').map(s => s.name), ['impeccable']);
  assert.deepEqual(selectSkills(skills, 'Design the newsletter page').map(s => s.name), ['emails', 'impeccable']);
});

test("a project skill replaces a shipped skill of the same name", () => {
  const root = projectWithSkill('description: Our own rules.', 'impeccable');
  const skills = availableSkills(root, CATALOG);
  assert.equal(skills.filter(s => s.name === 'impeccable').length, 1);
  assert.equal(skills.find(s => s.name === 'impeccable')!.repository, 'this project');
});

test('a project skill is attached from the project folder, files and all', async () => {
  const root = projectWithSkill('description: Our tokens.');
  const repo = tempRepo();
  const report = await attachSkills(repo, loadProjectSkills(root), tempCatalog());
  assert.deepEqual(report.attached, ['house-style']);
  assert.equal(fs.readFileSync(path.join(repo, '.agents/skills/house-style/reference/tokens.md'), 'utf8'), 'tokens');
});

test('skills:list includes the project\'s own skills', () => {
  const root = projectWithSkill('description: Our tokens.');
  assert.match(runDesignCommand('skills:list', [], { root }).output, /house-style\s+always\s+-\s+this project/);
});

// ---- Checking the result ----

const finding = (content: string, file = 'web/page.css') => checkDesign([{ path: file, content }]).map(f => f.rule);

test('each known anti-pattern is found, with the line it is on', () => {
  assert.deepEqual(finding('<p>Lorem ipsum dolor sit amet</p>', 'a.html'), ['placeholder-text']);
  assert.deepEqual(finding('<a href="#">Buy</a>', 'a.html'), ['dead-link']);
  assert.deepEqual(finding('<img src="a.png">', 'a.html'), ['image-without-alt']);
  assert.deepEqual(finding('h1{background-clip:text;color:transparent}'), ['gradient-text']);
  assert.deepEqual(finding('.card{box-shadow: 4px 4px 0 #000}'), ['hard-offset-shadow']);
  assert.deepEqual(finding('.card{border-left: 4px solid red}'), ['side-stripe-border']);
  assert.deepEqual(finding('a{outline: none}'), ['focus-outline-removed']);
  assert.deepEqual(finding('@keyframes spin{to{rotate:1turn}}'), ['motion-without-reduced-motion']);
  const [found] = checkDesign([{ path: 'a.html', content: '<p>ok</p>\n<a href="#">Buy</a>' }]);
  assert.deepEqual([found.file, found.line, found.evidence], ['a.html', 2, '<a href="#">Buy</a>']);
  assert.ok(found.fix.length > 0);
});

test('careful work passes: links that go somewhere, soft shadows, focus styles, reduced motion', () => {
  const css = '.card{box-shadow:0 8px 24px #0003;border-left:1px solid #333}\na{outline:none}\na:focus-visible{outline:2px solid}\n@keyframes in{to{opacity:1}}\n@media (prefers-reduced-motion:reduce){*{animation:none}}';
  assert.deepEqual(finding(css), []);
  assert.deepEqual(finding('<a href="#pricing">Pricing</a><img src="a.png" alt=""><a class="skip" href="#main">Skip</a>', 'a.html'), []);
});

test('only front-end files are checked', () => {
  assert.deepEqual(finding('const text = "lorem ipsum"; // href="#"', 'src/api/seed.ts'), []);
});

test('checkFiles reads the named files from a folder and skips ones that are gone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-check-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<a href="#">x</a>');
  assert.deepEqual(checkFiles(dir, ['index.html', 'deleted.css']).map(f => `${f.file}:${f.line} ${f.rule}`), ['index.html:1 dead-link']);
});

test('design:check prints findings as evidence and fails, or says the files are clean', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-check-'));
  fs.writeFileSync(path.join(root, 'bad.html'), '<a href="#">x</a>');
  fs.writeFileSync(path.join(root, 'good.html'), '<a href="/x">x</a>');
  const bad = runDesignCommand('design:check', ['bad.html'], { root });
  assert.equal(bad.exitCode, 1);
  assert.match(bad.output, /bad\.html:1\s+dead-link/);
  assert.match(bad.output, /pattern matches in the files, not opinions/);
  assert.deepEqual(runDesignCommand('design:check', ['good.html'], { root }), { output: 'Design check: no findings in 1 file.', exitCode: 0 });
});
