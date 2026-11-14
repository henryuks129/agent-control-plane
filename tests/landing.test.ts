import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// `npm test` runs from the repository root, and the compiled tests live in dist/tests,
// so the page is found from the working directory rather than from this file.
const siteDir = path.join(process.cwd(), 'site');
const read = (name: string): string => fs.readFileSync(path.join(siteDir, name), 'utf8');
const html = read('index.html');
const script = fs.existsSync(path.join(siteDir, 'landing.js')) ? read('landing.js') : '';
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

const QUICK_START = ['git clone https://github.com/henryuks129/agent-control-plane.git', 'cd agent-control-plane', 'docker compose up -d'];
const REPO = 'https://github.com/henryuks129/agent-control-plane';

/** The inner HTML of the element that carries `id`, up to the next element of the same tag that closes it. */
function block(id: string): string {
  const open = new RegExp(`<([a-z0-9]+)[^>]*\\sid="${id}"[^>]*>`).exec(html);
  assert.ok(open, `#${id} exists`);
  const rest = html.slice(open.index + open[0].length);
  const tag = open[1];
  let depth = 1;
  const walker = new RegExp(`<(/?)${tag}(?=[\\s>])`, 'g');
  for (let match = walker.exec(rest); match; match = walker.exec(rest)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return rest.slice(0, match.index);
  }
  return rest;
}
const plain = (fragment: string): string => fragment.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// ---- Structure a visitor and a keyboard user rely on ----

test('the page has one h1, a skip link, and the sections the navigation promises', () => {
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.match(html, /<a[^>]*class="skip"[^>]*href="#main"/);
  for (const id of ['main', 'demo', 'terminal', 'how', 'memory', 'status', 'start']) {
    assert.match(html, new RegExp(`\\sid="${id}"`), `#${id}`);
  }
  assert.match(html, /<html[^>]*\slang="en"/);
});

test('every link goes somewhere: in-page anchors resolve and none is a dead placeholder', () => {
  const hrefs = [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map(match => match[1]);
  assert.ok(hrefs.length > 8);
  assert.equal((html.match(/<a\b/g) ?? []).length, hrefs.length, 'every <a> has an href');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
  for (const href of hrefs) {
    assert.notEqual(href.trim(), '', 'empty href');
    assert.notEqual(href, '#', 'placeholder href');
    assert.doesNotMatch(href, /^javascript:/i);
    if (href.startsWith('#')) assert.ok(ids.has(href.slice(1)), `${href} resolves`);
  }
  assert.equal(ids.size, [...html.matchAll(/\sid="([^"]+)"/g)].length, 'ids are unique');
});

// ---- Conversion: what it is, and what to do ----

test('the first screen says what ACP is and offers the real quick start, copyable', () => {
  const hero = block('hero');
  assert.match(hero, /<h1/);
  assert.match(plain(hero), /open.source/i);
  assert.match(plain(hero), /Claude Code/);
  assert.match(hero, /data-copy="quickstart"/, 'the hero carries a copy button for the commands');
  assert.deepEqual(plain(block('quickstart')).trim().split('\n').map(line => line.trim()), QUICK_START);
  assert.ok(hero.includes(`href="${REPO}"`), 'GitHub is the second action');
  assert.ok(text.includes('127.0.0.1:4317'));
  assert.match(text, /MIT/);
});

test('each copy button points at commands that exist and at a status line that is announced', () => {
  const buttons = [...html.matchAll(/<button\b[^>]*data-copy="([^"]+)"[^>]*>/g)];
  assert.ok(buttons.length >= 2, 'hero and closing section');
  for (const [tag, target] of buttons) {
    assert.deepEqual(plain(block(target)).trim().split('\n').map(line => line.trim()), QUICK_START);
    const status = /data-copy-status="([^"]+)"/.exec(tag);
    assert.ok(status, 'names its status line');
    assert.match(html, new RegExp(`id="${status[1]}"[^>]*role="status"|role="status"[^>]*id="${status[1]}"`));
    assert.match(tag, /type="button"/);
  }
});

// ---- Honesty ----

test('the animated product demo is labelled as an illustration of the planned app', () => {
  const demo = block('demo');
  assert.match(plain(demo), /Illustration/);
  assert.match(plain(demo), /not a screenshot/i);
  assert.match(plain(demo), /being built/i);
  // The four things the demo has to show.
  for (const word of [/task/i, /worktree/i, /checkpoint/i, /approv/i]) assert.match(plain(demo), word);
});

test('the terminal shows the real commands and their real output, unchanged', () => {
  const terminal = plain(block('terminal-output'));
  for (const line of [
    '$ acp /agents list',
    'claude    Claude Code  2.1.190  ready  Claude Pro plan',
    'codex     Codex        0.160.0  ready  Signed in with ChatGPT',
    'opencode  OpenCode     2.2.5    ready  3 providers',
    '$ acp /skills check "Build a landing page"',
    'Design task: yes (request mentions "landing page")',
    'Skills: impeccable, awwwards',
    '$ acp /run codex --edit "Build a landing page"',
    'Codex finished (exit 0).',
    'Branch:   acp/run-mwf3d693',
    '  site/index.html',
    'Design skills: impeccable, awwwards',
    'Nothing has been merged.',
  ]) assert.ok(terminal.split('\n').includes(line), line);
});

test('status is stated plainly, with nothing invented to impress', () => {
  const status = plain(block('status'));
  for (const heading of ['Works now', 'Being built', 'Planned']) assert.ok(status.includes(heading), heading);
  assert.match(status, /web app/i);
  assert.match(status, /desktop app/i);
  assert.match(text, /in development/i);
  assert.doesNotMatch(text, /lorem ipsum|trusted by|testimonial|customers|\bstars\b|downloads|award/i);
  assert.doesNotMatch(html, /<video|<iframe/i, 'no footage: the demonstrations are built in the page');
});

// ---- Static site rules ----

test('nothing is loaded from another origin except the fonts', () => {
  for (const [, src] of html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)) {
    assert.doesNotMatch(src, /^(https?:)?\/\//, `${src} is local`);
    assert.ok(fs.existsSync(path.join(siteDir, src.replace(/^\.\//, ''))), `${src} exists`);
  }
  for (const [, href] of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) assert.match(href, /^https:\/\/fonts\.googleapis\.com\//);
  for (const [, href] of html.matchAll(/<link\b[^>]*href="([^"]+)"[^>]*rel="stylesheet"/g)) assert.match(href, /^https:\/\/fonts\.googleapis\.com\//);
  for (const [, src] of html.matchAll(/<(?:img|source)\b[^>]*\ssrc="([^"]+)"/g)) assert.doesNotMatch(src, /^(https?:)?\/\//);
  assert.match(html, /font-family:[^;}]*,\s*(system-ui|sans-serif)/, 'fonts have fallbacks');
});

test('the page passes the design pattern checks', () => {
  const all = `${html}\n${script}`;
  assert.doesNotMatch(all, /lorem ipsum/i);
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) assert.match(tag, /\salt="/, tag);
  assert.doesNotMatch(all, /background-clip\s*:\s*text/);
  assert.doesNotMatch(all, /box-shadow\s*:[^;}]*?\b\d+px\s+\d+px\s+0(?![\d.])/);
  assert.doesNotMatch(all, /border-(left|right)\s*:\s*([2-9]|\d{2,})px\s+solid/);
  assert.doesNotMatch(all, /border-(left|right)-width\s*:\s*([2-9]|\d{2,})px/);
  if (/outline\s*:\s*(none|0)\b/.test(all)) assert.match(all, /:focus-visible/);
  assert.match(css, /:focus-visible/, 'keyboard focus is styled');
  if (/@keyframes|animation\s*:/.test(all)) assert.match(css, /prefers-reduced-motion/);
});

// ---- Motion that cannot hide the page ----

test('there is real motion, and reduced motion is honoured in the styles and in the script', () => {
  assert.match(css, /@keyframes/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /visibilitychange/, 'loops stop when the tab is hidden');
  assert.match(script, /IntersectionObserver/, 'loops stop off screen');
});

test('content is visible by default: only classes the script adds may hide anything', () => {
  assert.doesNotMatch(/<html[^>]*>/.exec(html)?.[0] ?? '', /class=/, 'the script, not the markup, switches motion on');
  assert.doesNotMatch(html, /class="[^"]*\b(is-live|is-typing|pre)\b/);
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, selector, body] of rules) {
    if (/^\s*(from|to|\d+%)/.test(selector.trim())) continue; // keyframe steps
    if (!/opacity\s*:\s*0\s*(;|$)|visibility\s*:\s*hidden|display\s*:\s*none/.test(body)) continue;
    for (const part of selector.split(',')) {
      assert.match(part, /\.motion\b|\.is-live\b|\.is-typing\b|\[hidden\]|::?(before|after)/, `"${part.trim()}" hides content without the script`);
    }
  }
});

// ---- The page script, run against stand-in DOM objects ----

interface FakeElement {
  attributes: Record<string, string>;
  textContent: string;
  hidden: boolean;
  handlers: Record<string, Array<(event: unknown) => unknown>>;
  classes: Set<string>;
  classList: { add(...names: string[]): void; remove(...names: string[]): void; contains(name: string): boolean; toggle(name: string, on?: boolean): void };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: (event: unknown) => unknown): void;
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
  children: Record<string, FakeElement>;
}

function element(attributes: Record<string, string> = {}, textContent = ''): FakeElement {
  const classes = new Set<string>();
  const self: FakeElement = {
    attributes, textContent, hidden: false, handlers: {}, classes, children: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, on) => { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
    },
    getAttribute: name => self.attributes[name] ?? null,
    setAttribute: (name, value) => { self.attributes[name] = value; },
    addEventListener: (type, handler) => { (self.handlers[type] ??= []).push(handler); },
    querySelector: selector => self.children[selector] ?? null,
    querySelectorAll: () => [],
  };
  return self;
}

function runPage(options: { clipboard?: { writeText(value: string): Promise<void> }; reducedMotion: boolean }) {
  const label = element({}, 'Copy');
  const button = element({ 'data-copy': 'quickstart', 'data-copy-status': 'copy-status' });
  button.children['[data-copy-label]'] = label;
  const code = element({}, QUICK_START.join('\n'));
  const status = element();
  const root = element();
  const selected: unknown[] = [];
  const timers: Array<() => void> = [];
  const byId: Record<string, FakeElement> = { quickstart: code, 'copy-status': status };
  const document = {
    documentElement: root, hidden: false,
    getElementById: (id: string) => byId[id] ?? null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => (selector === '[data-copy]' ? [button] : []),
    addEventListener: () => undefined,
    createRange: () => ({ selectNodeContents: (node: unknown) => { selected.push(node); } }),
  };
  const window = {
    matchMedia: (query: string) => ({ matches: options.reducedMotion && query.includes('reduce'), addEventListener: () => undefined }),
    getSelection: () => ({ removeAllRanges: () => undefined, addRange: () => undefined }),
    addEventListener: () => undefined,
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
    clearTimeout: () => undefined,
    requestAnimationFrame: (callback: () => void) => { timers.push(callback); return timers.length; },
    IntersectionObserver: class { observe() { /* nothing is on screen in this stand-in */ } unobserve() { /* same */ } disconnect() { /* same */ } },
  };
  const context = vm.createContext({ document, window, navigator: { clipboard: options.clipboard }, ...window });
  vm.runInContext(script, context, { filename: 'landing.js' });
  const click = async () => { for (const handler of button.handlers.click ?? []) await handler({ preventDefault: () => undefined }); };
  return { button, label, status, root, selected, code, click, timers };
}

test('the copy button puts the three commands on the clipboard and says so', async () => {
  const written: string[] = [];
  const page = runPage({ clipboard: { writeText: async value => { written.push(value); } }, reducedMotion: true });
  assert.equal(page.button.handlers.click?.length, 1);
  await page.click();
  assert.deepEqual(written, [QUICK_START.join('\n')]);
  assert.match(page.status.textContent, /copied/i);
  assert.equal(page.label.textContent, 'Copied');
});

test('when the clipboard is refused or missing, the commands are selected and the visitor is told how to copy', async () => {
  const refused = runPage({ clipboard: { writeText: async () => { throw new Error('denied'); } }, reducedMotion: true });
  await refused.click();
  assert.deepEqual(refused.selected, [refused.code], 'the commands are selected for a manual copy');
  assert.match(refused.status.textContent, /select|press/i);
  assert.notEqual(refused.label.textContent, 'Copied');

  const missing = runPage({ reducedMotion: true });
  await missing.click();
  assert.deepEqual(missing.selected, [missing.code]);
  assert.match(missing.status.textContent, /select|press/i);
});

test('with reduced motion the script switches nothing on; without it, motion is switched on', () => {
  const calm = runPage({ reducedMotion: true });
  assert.equal(calm.root.classes.has('motion'), false);
  const moving = runPage({ reducedMotion: false });
  assert.equal(moving.root.classes.has('motion'), true);
});
