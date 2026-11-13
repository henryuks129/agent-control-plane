import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesPath, specificity } from '../src/memory/match.js';
import { parseRule } from '../src/memory/rules.js';

// ---- Matching a rule's path pattern to a file ----

test('a ** pattern matches files at any depth under the folder', () => {
  assert.equal(matchesPath('src/api/**', 'src/api/account/create.ts'), true);
  assert.equal(matchesPath('src/api/**', 'src/ui/button.tsx'), false);
});

test('a * stays inside one folder level', () => {
  assert.equal(matchesPath('src/*.ts', 'src/index.ts'), true);
  assert.equal(matchesPath('src/*.ts', 'src/api/index.ts'), false);
});

test('a bare folder name covers everything inside it', () => {
  assert.equal(matchesPath('src/api', 'src/api/account/create.ts'), true);
  assert.equal(matchesPath('src/api', 'src/apiary/x.ts'), false);
});

test('**/ at the start matches the file in the root and in subfolders', () => {
  assert.equal(matchesPath('**/*.css', 'site.css'), true);
  assert.equal(matchesPath('**/*.css', 'web/styles/site.css'), true);
});

test('Windows separators and a leading ./ are treated like plain paths', () => {
  assert.equal(matchesPath('src/api/**', '.\\src\\api\\a.ts'), true);
});

test('a deeper pattern is more specific than a shallow one', () => {
  assert.ok(specificity('src/api/account/**') > specificity('src/**'));
  assert.ok(specificity('src/**') > specificity('**/*.ts'));
});

// ---- Reading a rule file ----

test('a rule file gives its paths, keywords, check, origin and body', () => {
  const rule = parseRule('hash-passwords.md', [
    '---',
    'paths:',
    '  - src/api/account/**',
    '  - src/auth/**',
    'keywords: [password, signup]',
    'check: npm test -- account',
    'learned-from: TASK-0042',
    '---',
    'Hash passwords with the existing helper before saving.',
    '',
  ].join('\n'));
  assert.equal(rule.name, 'hash-passwords');
  assert.deepEqual(rule.paths, ['src/api/account/**', 'src/auth/**']);
  assert.deepEqual(rule.keywords, ['password', 'signup']);
  assert.equal(rule.check, 'npm test -- account');
  assert.equal(rule.learnedFrom, 'TASK-0042');
  assert.equal(rule.body, 'Hash passwords with the existing helper before saving.');
});

test('a rule file with no header applies nowhere by path and keeps its whole text', () => {
  const rule = parseRule('notes.md', 'Just a note.\n');
  assert.deepEqual(rule.paths, []);
  assert.equal(rule.body, 'Just a note.');
});

test('quotes around a header value are dropped', () => {
  const rule = parseRule('q.md', '---\npaths: ["src/**"]\ncheck: "npm run lint"\n---\nBody');
  assert.deepEqual(rule.paths, ['src/**']);
  assert.equal(rule.check, 'npm run lint');
});

// ---- Project memory on disk ----

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProjectMemory, loadProjectMemory, loadUserMemory } from '../src/memory/store.js';
import { resolveMemory, renderBundle } from '../src/memory/resolve.js';

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acp-memory-'));
}
function write(root: string, relative: string, text: string) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const rule = (name: string, paths: string[], body: string, extra: Partial<{ keywords: string[]; learnedFrom: string; check: string }> = {}) =>
  ({ name, paths, keywords: extra.keywords ?? [], body, learnedFrom: extra.learnedFrom, check: extra.check });

test('init creates the memory files and keeps local memory out of Git', () => {
  const root = tempProject();
  const created = initProjectMemory(root);
  assert.ok(fs.existsSync(path.join(root, '.acp/knowledge.md')));
  assert.ok(fs.statSync(path.join(root, '.acp/rules')).isDirectory());
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\.acp\/local\/$/m);
  assert.deepEqual(created.sort(), ['.acp/knowledge.md', '.acp/rules/', '.gitignore']);
});

test('init never overwrites what a person already wrote', () => {
  const root = tempProject();
  write(root, '.acp/knowledge.md', 'Our goals.\n');
  write(root, '.gitignore', 'node_modules/\n.acp/local/\n');
  const created = initProjectMemory(root);
  assert.equal(fs.readFileSync(path.join(root, '.acp/knowledge.md'), 'utf8'), 'Our goals.\n');
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'node_modules/\n.acp/local/\n');
  assert.deepEqual(created, ['.acp/rules/']);
});

test('load reads knowledge and every rule file, in name order', () => {
  const root = tempProject();
  write(root, '.acp/knowledge.md', 'Ship small changes.\n');
  write(root, '.acp/rules/b-ui.md', '---\npaths: [src/ui/**]\n---\nUse the design library.');
  write(root, '.acp/rules/a-api.md', '---\npaths: [src/api/**]\n---\nValidate input.');
  write(root, '.acp/rules/README.txt', 'not a rule');
  const memory = loadProjectMemory(root);
  assert.equal(memory.knowledge, 'Ship small changes.');
  assert.deepEqual(memory.rules.map(r => r.name), ['a-api', 'b-ui']);
});

test('a project with no .acp folder has empty memory, not an error', () => {
  assert.deepEqual(loadProjectMemory(tempProject()), { knowledge: '', rules: [] });
});

test('user memory is read from ACP storage, outside the project', () => {
  const dataDir = tempProject();
  assert.equal(loadUserMemory(dataDir), '');
  write(dataDir, 'memory/user.md', 'I prefer small pull requests.\n');
  assert.equal(loadUserMemory(dataDir), 'I prefer small pull requests.');
});

// ---- Choosing what a task receives ----

test('a task receives only the rules whose paths match its files', () => {
  const project = { knowledge: 'K', rules: [rule('api', ['src/api/**'], 'Validate input.'), rule('ui', ['src/ui/**'], 'Use the library.')] };
  const bundle = resolveMemory({ project, files: ['src/api/account/create.ts'] });
  assert.deepEqual(bundle.sections.filter(s => s.layer === 'rule').map(s => s.title), ['api']);
});

test('sections run from broadest to narrowest so the narrower one is read last', () => {
  const project = { knowledge: 'K', rules: [rule('account', ['src/api/account/**'], 'Narrow.'), rule('src', ['src/**'], 'Broad.')] };
  const bundle = resolveMemory({ project, user: 'U', checkpoint: 'C', files: ['src/api/account/create.ts'] });
  assert.deepEqual(bundle.sections.map(s => `${s.layer}:${s.title}`), ['user:You', 'project:Project', 'rule:src', 'rule:account', 'task:Task progress']);
});

test('empty layers are left out', () => {
  const bundle = resolveMemory({ project: { knowledge: '', rules: [] }, files: ['a.ts'] });
  assert.deepEqual(bundle.sections, []);
});

test('the guard brings in a rule whose keyword appears in the request, even with no file match', () => {
  const project = { knowledge: '', rules: [rule('passwords', ['src/auth/**'], 'Hash them.', { keywords: ['password'] }), rule('other', ['docs/**'], 'Unrelated.', { keywords: ['deploy'] })] };
  const bundle = resolveMemory({ project, files: ['src/api/signup.ts'], request: 'Add a Password reset form' });
  assert.deepEqual(bundle.sections.map(s => s.title), ['passwords']);
});

test('a keyword must be a whole word, so "pass" does not match "password"', () => {
  const project = { knowledge: '', rules: [rule('pass', [], 'Boarding pass rule.', { keywords: ['pass'] })] };
  assert.deepEqual(resolveMemory({ project, files: [], request: 'change the password' }).sections, []);
});

test('when rules exceed the budget, whole rules are dropped, least specific first, and named', () => {
  const big = 'x'.repeat(600);
  const project = { knowledge: '', rules: [rule('broad', ['src/**'], big), rule('mid', ['src/api/**'], big), rule('narrow', ['src/api/account/**'], big)] };
  const bundle = resolveMemory({ project, files: ['src/api/account/a.ts'], ruleBudgetBytes: 1300 });
  assert.deepEqual(bundle.sections.map(s => s.title), ['mid', 'narrow']);
  assert.deepEqual(bundle.omittedRules, ['broad']);
  assert.ok(bundle.sections.every(s => s.content === big), 'a kept rule is never cut short');
});

test('the rendered text says narrower wins and marks rules that came from a past mistake', () => {
  const project = { knowledge: 'K', rules: [rule('passwords', ['src/**'], 'Hash them.', { learnedFrom: 'TASK-0042', check: 'npm test' }), rule('big', ['src/**'], 'y'.repeat(50))] };
  const text = renderBundle(resolveMemory({ project, files: ['src/a.ts'], ruleBudgetBytes: 20 }));
  assert.match(text, /narrower/i);
  assert.match(text, /Past mistake \(TASK-0042\)/);
  assert.match(text, /checked by: `npm test`/);
  assert.match(text, /not shown.*big/is);
});

// ---- The summary ACP writes into AGENTS.md ----

import { buildSummary, syncBlock, ensureClaudeImport, findSecrets, syncProject } from '../src/memory/agents-file.js';

test('with no AGENTS.md, sync creates one holding only the marked block', () => {
  const result = syncBlock(null, 'Summary one.');
  assert.equal(result.status, 'created');
  assert.match(result.text, /^<!-- acp:begin sha256=[0-9a-f]{12}[^>]*-->\nSummary one\.\n<!-- acp:end -->\n$/);
});

test('an existing AGENTS.md keeps its own text exactly and gains the block at the end', () => {
  const mine = '# My rules\n\nAlways run the tests.\n';
  const result = syncBlock(mine, 'Summary one.');
  assert.equal(result.status, 'updated');
  assert.ok(result.text.startsWith(mine + '\n<!-- acp:begin'));
});

test('syncing the same summary again changes nothing', () => {
  const first = syncBlock('# Mine\n', 'Summary one.').text;
  const second = syncBlock(first, 'Summary one.');
  assert.equal(second.status, 'unchanged');
  assert.equal(second.text, first);
});

test('a new summary replaces the block and leaves the text around it alone', () => {
  const first = syncBlock('# Before\n', 'Summary one.').text + '\n# After\n';
  const second = syncBlock(first, 'Summary two.');
  assert.equal(second.status, 'updated');
  assert.ok(second.text.startsWith('# Before\n'));
  assert.ok(second.text.endsWith('\n# After\n'));
  assert.match(second.text, /Summary two\./);
  assert.doesNotMatch(second.text, /Summary one\./);
});

test('a block someone edited by hand is reported as a conflict and not overwritten', () => {
  const edited = syncBlock(null, 'Summary one.').text.replace('Summary one.', 'Summary one, plus my edit.');
  const result = syncBlock(edited, 'Summary two.');
  assert.equal(result.status, 'conflict');
  assert.equal(result.text, edited);
});

test('the summary holds the knowledge and one line per rule with its paths', () => {
  const summary = buildSummary({ knowledge: 'Ship small changes.', rules: [rule('api', ['src/api/**'], 'Validate input.'), rule('mistake', ['src/**'], 'Hash.', { learnedFrom: 'TASK-1' })] });
  assert.equal(summary.truncated, false);
  assert.match(summary.text, /Ship small changes\./);
  assert.match(summary.text, /- `api` applies to `src\/api\/\*\*` \(\.acp\/rules\/api\.md\)/);
  assert.doesNotMatch(summary.text, /Validate input\./, 'rule bodies stay out; agents open the file when a rule applies');
});

test('a summary over the budget is cut at a paragraph, says so, and still fits', () => {
  const knowledge = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'word '.repeat(30)}`).join('\n\n');
  const summary = buildSummary({ knowledge, rules: [] }, 1024);
  assert.equal(summary.truncated, true);
  assert.ok(Buffer.byteLength(summary.text) <= 1024);
  assert.match(summary.text, /Paragraph 0 /);
  assert.match(summary.text, /cut to fit.*\.acp\/knowledge\.md/s);
  const kept = summary.text.split('\n').filter(line => line.startsWith('Paragraph'));
  assert.ok(kept.length > 0 && kept.length < 40);
  for (const line of kept) assert.equal(line.match(/word/g)?.length, 30, 'no paragraph is cut in the middle');
});

test('CLAUDE.md gains an import of AGENTS.md only when it does not already mention it', () => {
  assert.deepEqual(ensureClaudeImport(null), { text: '@AGENTS.md\n', changed: true });
  assert.deepEqual(ensureClaudeImport('# Claude notes\n'), { text: '# Claude notes\n\n@AGENTS.md\n', changed: true });
  assert.deepEqual(ensureClaudeImport('See @AGENTS.md first.\n'), { text: 'See @AGENTS.md first.\n', changed: false });
});

test('text shaped like a key or password is flagged, ordinary text is not', () => {
  assert.deepEqual(findSecrets('Use the helper in src/auth to hash passwords.'), []);
  assert.deepEqual(findSecrets('token: ghp_' + 'a'.repeat(36)), ['GitHub token']);
  assert.deepEqual(findSecrets('-----BEGIN RSA PRIVATE KEY-----'), ['private key']);
  assert.deepEqual(findSecrets('API_KEY = "abcd1234efgh5678ijkl"'), ['assigned secret']);
});

test('syncing a project writes AGENTS.md and CLAUDE.md from .acp', () => {
  const root = tempProject();
  write(root, '.acp/knowledge.md', 'Ship small changes.\n');
  write(root, 'AGENTS.md', '# Mine\n');
  const report = syncProject(root);
  assert.deepEqual({ agents: report.agents, claude: report.claude, problems: report.problems }, { agents: 'updated', claude: 'created', problems: [] });
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /^# Mine\n\n<!-- acp:begin[\s\S]*Ship small changes\./);
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.equal(syncProject(root).agents, 'unchanged');
});

test('memory that contains a secret is not written anywhere', () => {
  const root = tempProject();
  write(root, '.acp/knowledge.md', 'Deploy with ghp_' + 'b'.repeat(36) + '\n');
  const report = syncProject(root);
  assert.match(report.problems.join(' '), /GitHub token.*\.acp\/knowledge\.md/);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});

test('check mode reports what would change and writes nothing', () => {
  const root = tempProject();
  write(root, '.acp/knowledge.md', 'Ship small changes.\n');
  const report = syncProject(root, { check: true });
  assert.equal(report.agents, 'created');
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});

// ---- Commands ----

import { runMemoryCommand } from '../src/memory/cli.js';
import { ContextRouter } from '../src/context/router.js';

test('memory:init then memory:show prints the layers for the given files and request', () => {
  const root = tempProject(); const dataDir = tempProject();
  assert.equal(runMemoryCommand('memory:init', [], { root, dataDir }).exitCode, 0);
  write(root, '.acp/knowledge.md', 'Ship small changes.\n');
  write(root, '.acp/rules/passwords.md', '---\npaths: [src/auth/**]\nkeywords: [password]\n---\nHash them.');
  write(dataDir, 'memory/user.md', 'Prefer small pull requests.\n');
  const shown = runMemoryCommand('memory:show', ['--request', 'reset password', 'src/api/a.ts'], { root, dataDir });
  assert.equal(shown.exitCode, 0);
  assert.match(shown.output, /Prefer small pull requests\.[\s\S]*Ship small changes\.[\s\S]*Rule: passwords[\s\S]*Hash them\./);
});

test('memory:show says so when there is no memory yet', () => {
  const shown = runMemoryCommand('memory:show', ['a.ts'], { root: tempProject(), dataDir: tempProject() });
  assert.match(shown.output, /No memory applies/);
});

test('memory:sync --check fails while AGENTS.md is out of date and passes after a sync', () => {
  const root = tempProject(); const dataDir = tempProject();
  write(root, '.acp/knowledge.md', 'Ship small changes.\n');
  assert.equal(runMemoryCommand('memory:sync', ['--check'], { root, dataDir }).exitCode, 1);
  assert.equal(runMemoryCommand('memory:sync', [], { root, dataDir }).exitCode, 0);
  assert.equal(runMemoryCommand('memory:sync', ['--check'], { root, dataDir }).exitCode, 0);
});

test('memory:sync fails and explains when memory holds a secret', () => {
  const root = tempProject();
  write(root, '.acp/knowledge.md', 'key ghp_' + 'c'.repeat(36) + '\n');
  const result = runMemoryCommand('memory:sync', [], { root, dataDir: tempProject() });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /GitHub token/);
});

test('an unknown memory command lists the real ones', () => {
  const result = runMemoryCommand('memory:nope', [], { root: tempProject(), dataDir: tempProject() });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /memory:init[\s\S]*memory:show[\s\S]*memory:sync/);
});

// ---- Tasks receive memory ----

test('a task context includes the memory that applies to the task scope', () => {
  const root = tempProject();
  write(root, 'src/api/a.ts', 'export const a = 1;\n');
  write(root, '.acp/knowledge.md', 'Ship small changes.\n');
  write(root, '.acp/rules/api.md', '---\npaths: [src/api/**]\n---\nValidate input.');
  write(root, '.acp/rules/ui.md', '---\npaths: [src/ui/**]\n---\nUse the library.');
  const task = { id: 'T-1', title: 'Add endpoint', objective: 'Add an endpoint', type: 'feature', scope: { allowed: ['src/api/**'] }, acceptance: ['works'], review: { required: [] } };
  const pack = new ContextRouter(root).build(task);
  const memory = pack.docs.find(doc => doc.reason === 'ACP memory for this task');
  assert.ok(memory, 'memory is part of the context');
  assert.match(memory.content, /Ship small changes\.[\s\S]*Validate input\./);
  assert.doesNotMatch(memory.content, /Use the library\./);
});

test('a task scope with no files yet still gets the rules for that folder', () => {
  const root = tempProject();
  write(root, '.acp/rules/api.md', '---\npaths: [src/api/**]\n---\nValidate input.');
  const task = { id: 'T-2', title: 'New', objective: 'New module', type: 'feature', scope: { allowed: ['src/api/**'] }, acceptance: ['works'], review: { required: [] } };
  const pack = new ContextRouter(root).build(task);
  assert.match(pack.docs.find(doc => doc.reason === 'ACP memory for this task')?.content ?? '', /Validate input\./);
});
