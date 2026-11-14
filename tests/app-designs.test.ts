import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The app prototypes are plain files with no build step, so these checks read
// them as text. `npm test` runs from the repository root.
const dir = path.join(process.cwd(), 'design-library', 'candidates', 'app');

const expectedPages = [
  'index.html', 'onboarding.html', 'thread.html', 'review.html', 'agents.html',
  'memory.html', 'runs.html', 'design-library.html', 'usage.html', 'git.html',
  'settings.html', 'report.html', 'error.html',
];

const settingsSections = [
  'General', 'Agents &amp; models', 'Permissions', 'Memory', 'Design skills',
  'Connections', 'Notifications', 'Keyboard shortcuts', 'Privacy &amp; data',
  'Advanced', 'About',
];

function read(name: string): string {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function pages(): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.html')).sort() : [];
}

function attributes(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(match => match[1]);
}

function ids(html: string): Set<string> {
  return new Set(attributes(html, 'id'));
}

function isExternal(target: string): boolean {
  return /^(https?:|mailto:|data:)/.test(target);
}

function withoutTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

test('the app prototype folder has every page, one stylesheet, one script and a README', () => {
  assert.deepEqual(pages(), [...expectedPages].sort());
  for (const name of ['app.css', 'app.js', 'README.md']) assert.ok(read(name).length > 0, `${name} is missing or empty`);
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.css') || name.endsWith('.js')).sort(), ['app.css', 'app.js']);
});

test('the index links to every page', () => {
  const linked = new Set(attributes(read('index.html'), 'href').filter(target => !isExternal(target)).map(target => target.split('#')[0]));
  for (const name of expectedPages.filter(page => page !== 'index.html')) assert.ok(linked.has(name), `index.html does not link to ${name}`);
  for (const target of linked) if (target.endsWith('.html')) assert.ok(fs.existsSync(path.join(dir, target)), `index.html links to ${target}, which does not exist`);
});

test('every local link and asset resolves, including the part after #', () => {
  for (const name of pages()) {
    const html = read(name);
    for (const target of [...attributes(html, 'href'), ...attributes(html, 'src')]) {
      if (isExternal(target)) continue;
      const [file, fragment] = target.split('#');
      const targetName = file === '' ? name : file;
      assert.ok(fs.existsSync(path.join(dir, targetName)), `${name}: "${target}" points at a missing file`);
      if (fragment !== undefined) {
        assert.notEqual(fragment, '', `${name}: "${target}" has an empty fragment`);
        assert.ok(ids(read(targetName)).has(fragment), `${name}: "${target}" points at an id that is not in ${targetName}`);
      }
    }
    for (const attribute of ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for', 'data-open-dialog', 'data-show', 'data-hide', 'data-toggle', 'data-goto-tab']) {
      for (const value of attributes(html, attribute)) {
        for (const id of value.split(/\s+/).filter(Boolean)) assert.ok(ids(html).has(id), `${name}: ${attribute}="${id}" has no matching id`);
      }
    }
  }
});

test('no dead links: no href="#", empty href or javascript: link', () => {
  for (const name of pages()) {
    const html = read(name);
    for (const target of attributes(html, 'href')) {
      assert.notEqual(target, '#', `${name} has href="#"`);
      assert.notEqual(target.trim(), '', `${name} has an empty href`);
      assert.ok(!/^javascript:/i.test(target), `${name} has a javascript: link`);
    }
    assert.ok(!/<a\b(?![^>]*\shref=)[^>]*>/.test(html), `${name} has an <a> without href`);
    assert.ok(!/\son[a-z]+="/.test(html), `${name} has an inline event handler`);
  }
});

test('each page has one h1, a language, a title, the shared stylesheet and script, and the design-candidate line', () => {
  const titles = new Set<string>();
  for (const name of pages()) {
    const html = read(name);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${name} must have exactly one h1`);
    assert.match(html, /<html[^>]*\slang="[a-z-]+"/, `${name} has no lang`);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1].trim() ?? '';
    assert.ok(title.length > 0, `${name} has no title`);
    assert.ok(!titles.has(title), `${name} repeats the title "${title}"`);
    titles.add(title);
    assert.match(html, /<link[^>]*rel="stylesheet"[^>]*href="app\.css"/, `${name} does not load app.css`);
    assert.match(html, /<script[^>]*src="app\.js"/, `${name} does not load app.js`);
    assert.ok(!/<style[\s>]/.test(html) && !/\sstyle="/.test(html), `${name} has its own styles instead of using app.css`);
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html), `${name} has an inline script`);
    const footer = html.match(/<footer[^>]*class="[^"]*candidate-note[^"]*"[^>]*>([\s\S]*?)<\/footer>/)?.[1] ?? '';
    assert.match(withoutTags(footer), /design candidate/i, `${name} has no design-candidate footer line`);
    assert.match(withoutTags(footer), /not built yet/i, `${name}: the footer must say the app is not built yet`);
  }
});

test('no outside scripts or stylesheets except the font link', () => {
  for (const name of pages()) {
    const html = read(name);
    for (const target of attributes(html, 'src')) assert.ok(!isExternal(target), `${name} loads ${target}`);
    for (const tag of html.match(/<link[^>]*>/g) ?? []) {
      const target = tag.match(/\shref="([^"]*)"/)?.[1] ?? '';
      if (isExternal(target)) assert.match(target, /^https:\/\/fonts\.(googleapis|gstatic)\.com/, `${name} links to ${target}`);
    }
  }
});

test('every image has alt text and no placeholder copy is left in', () => {
  for (const name of pages()) {
    const html = read(name);
    for (const tag of html.match(/<img\b[^>]*>/g) ?? []) assert.match(tag, /\salt="/, `${name}: ${tag} has no alt`);
    assert.ok(!/lorem ipsum|dolor sit|TODO|TBD|placeholder text|example\.com/i.test(withoutTags(html)), `${name} contains placeholder text`);
  }
});

test('the stylesheet uses tokens, has no gradients or gradient text, and respects reduced motion', () => {
  const css = read('app.css');
  for (const token of ['--ground', '--panel', '--line', '--text', '--muted', '--ok', '--warn', '--focus']) assert.match(css, new RegExp(`${token}\\s*:`), `app.css does not define ${token}`);
  assert.match(css, /\[data-theme="light"\]/, 'app.css has no light theme');
  assert.ok(!/gradient\(/.test(css), 'app.css uses a gradient');
  assert.ok(!/background-clip\s*:\s*text|text-fill-color/.test(css), 'app.css uses gradient text');
  assert.ok(!/backdrop-filter/.test(css), 'app.css uses a glass effect');
  // A hard offset shadow is an offset with no blur, such as "4px 4px 0".
  assert.ok(!/box-shadow\s*:[^;]*\b[1-9]\d*px\s+[1-9]\d*px\s+0(px)?\s+(?!\d)/.test(css), 'app.css uses a hard offset shadow');
  assert.ok(!/border-(left|right|inline-start|inline-end)\s*:\s*([2-9]|\d\d)px/.test(css), 'app.css uses a thick side-stripe border');
  assert.match(css, /:focus-visible/, 'app.css has no keyboard focus style');
  if (/animation|transition/.test(css)) assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, 'app.css animates without handling reduced motion');
  const script = read('app.js');
  assert.ok(!/\bimport\b|\brequire\(|https?:\/\//.test(script), 'app.js must not load anything');
});

test('the settings page has every section, each with a heading and a link in the section nav', () => {
  const html = read('settings.html');
  const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(match => match[1].replace(/<[^>]+>/g, '').trim());
  const nav = html.match(/<nav[^>]*class="[^"]*section-nav[^"]*"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  const navLabels = [...nav.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map(match => match[1].replace(/<[^>]+>/g, '').trim());
  for (const section of settingsSections) {
    assert.ok(headings.includes(section), `settings.html has no "${section}" section`);
    assert.ok(navLabels.includes(section), `settings.html section nav has no "${section}" link`);
  }
});

test('the thread header holds a status line and no Stop, Resume or Review control', () => {
  const html = read('thread.html');
  const header = html.match(/<header[^>]*class="[^"]*thread-head[^"]*"[^>]*>([\s\S]*?)<\/header>/)?.[1] ?? '';
  assert.ok(header.length > 0, 'thread.html has no thread header');
  assert.match(withoutTags(header), /2 working · 2 ready to review/, 'the thread header has no status line');
  assert.ok(!/<(button|a|input|select)\b/.test(header), 'the thread header must not hold controls');
  assert.ok(!/\b(Stop|Resume|Review)\b/.test(withoutTags(header)), 'the thread header must not offer Stop, Resume or Review');
  // The controls live on the rows and beside Send instead.
  assert.match(html, /<button[^>]*>\s*Resume\s*<\/button>/, 'a stopped task row needs Resume');
  assert.match(html, /<a[^>]*href="review\.html[^"]*"[^>]*>\s*Review\s*<\/a>/, 'a ready task row needs Review');
  assert.match(html, /Stop this task/, 'an opened working task needs "Stop this task"');
  assert.ok(!/Code\s*\/\s*Ask|>Ask mode<|>Code mode</.test(html), 'the thread must not have a Code / Ask switch');
});

test('a credential is only ever typed into the secret card', () => {
  for (const name of pages()) {
    const fields = read(name).match(/<input[^>]*type="password"[^>]*>/g) ?? [];
    if (name === 'thread.html') assert.equal(fields.length, 1, 'thread.html needs one private field, in the secret card');
    else assert.equal(fields.length, 0, `${name} asks for a password or token`);
  }
  assert.match(read('thread.html'), /class="[^"]*secret-card/);
});
