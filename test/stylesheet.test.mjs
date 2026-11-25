// Structural guards for the stylesheets. The contrast suite proves the colours
// are legible; this one proves the files themselves are well-formed, that every
// var() reference resolves, and that no component re-invents the design scale —
// which is what a typo would silently break.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// tokens.css is loaded first by every page and holds the only :root blocks.
// style.css dresses index.html; resume.css dresses resume.html and may add its
// own print-only token overrides.
const fontsPath = new URL('../css/fonts.css', import.meta.url);
const tokensPath = new URL('../css/tokens.css', import.meta.url);
const stylePath = new URL('../css/style.css', import.meta.url);
const resumePath = new URL('../css/resume.css', import.meta.url);
const fonts = fs.readFileSync(fontsPath, 'utf8');
const tokens = fs.readFileSync(tokensPath, 'utf8');
const page = fs.readFileSync(stylePath, 'utf8');
const resume = fs.readFileSync(resumePath, 'utf8');
const css = `${fonts}\n${tokens}\n${page}\n${resume}`;
const PAGE_FILES = [
  { name: 'css/fonts.css', source: fonts },
  { name: 'css/tokens.css', source: tokens },
  { name: 'css/style.css', source: page },
  { name: 'css/resume.css', source: resume },
];

test('stylesheet: braces are balanced in every stylesheet', () => {
  for (const { name, source } of PAGE_FILES) {
    let depth = 0;
    for (const character of source) {
      if (character === '{') depth += 1;
      if (character === '}') depth -= 1;
      assert.ok(depth >= 0, `${name}: a closing brace appears before its opening brace`);
    }
    assert.equal(depth, 0, `${name}: every brace is closed`);
  }
  assert.ok(tokens.includes('1. DESIGN TOKENS'), 'the token section is documented');
  assert.ok(tokens.includes('shared by every page'), 'the token section says it is shared');
  assert.ok(page.trimStart().startsWith('*'), 'the reset still leads the page stylesheet');
  assert.ok(page.includes('2. PAGE SHELL'), 'the page stylesheet is sectioned');
});

test('stylesheet: no rule is pasted inside another rule', () => {
  // Balanced braces are not enough: a block pasted between a selector and its
  // declarations still balances, and modern CSS nesting then scopes it under
  // that selector, so it silently never matches (this hid the Impact grid).
  // Only at-rules (@media, @supports, @keyframes, …) may contain blocks.
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  for (const { name, source } of PAGE_FILES) {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, blank);
    const stack = [];
    let start = 0;
    for (let i = 0; i < code.length; i += 1) {
      const character = code[i];
      if (character === '{') {
        const prelude = code.slice(start, i).trim();
        if (stack.at(-1) === 'rule') {
          const line = code.slice(0, i).split('\n').length;
          assert.fail(`${name}:${line}: "${prelude.split('\n').pop().trim()}" opens inside a rule; close the outer rule first`);
        }
        stack.push(prelude.startsWith('@') ? 'at' : 'rule');
        start = i + 1;
      } else if (character === '}') {
        stack.pop();
        start = i + 1;
      } else if (character === ';') {
        start = i + 1;
      }
    }
  }
});

// Custom properties that JavaScript owns: it writes them with setProperty and
// the stylesheet only ever reads them. Keeping the list explicit means a typo
// in a static var() still fails the suite.
const JS_OWNED = new Set(['--i', '--x', '--y', '--mx', '--my', '--nav-progress', '--d']);

// Tokens declared for the dark-scheme comprehension of the palette rather than
// for a rule in this file. Anything else unused is dead weight.
const RESERVED = new Set(['--text-faint-dark']);

test('stylesheet: every var() reference is declared (in :root or by a component)', () => {
  const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const consumed = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]));
  const undeclared = [...consumed]
    .filter((token) => !declared.has(token) && !JS_OWNED.has(token))
    .sort();
  assert.deepEqual(undeclared, [], `var() references with no declaration: ${undeclared.join(', ')}`);

  // And the JS-owned list must stay honest: main.js really does set them.
  const mainJs = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  for (const token of JS_OWNED) {
    assert.ok(mainJs.includes(`'${token}'`), `${token} is set from js/main.js`);
  }
});

test('stylesheet: no raw colour in a component rule', () => {
  // Removes one at-rule by matching braces. A greedy regex here once swallowed
  // the @media screen block that follows the print block, hiding it from the check.
  const stripAtBlock = (source, header) => {
    const start = source.search(header);
    if (start === -1) return source;
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(0, start) + source.slice(i + 1);
      }
    }
    return source;
  };
  // Every colour belongs in a :root block: the shared tokens, the dark-scheme
  // override, or resume.css's print override. Strip those (and the whole print
  // block, whose literal black-on-white values are the point of printing), plus
  // any embedded SVG data URI, and nothing below them may still name a colour.
  const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');
  const kept = [];
  for (const { name, source } of PAGE_FILES) {
    let stripped = withoutComments(source).replace(/:root\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, '');
    if (name.endsWith('resume.css')) stripped = stripAtBlock(stripped, /@media\s+print\s*\{/);
    stripped = stripped.replace(/url\("data:[^"]*"\)/g, 'url(data-uri)');
    for (const match of stripped.matchAll(/(?<![\w-])(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/gi)) {
      kept.push(`${name}: ${match[1]}`);
    }
  }
  assert.deepEqual(kept, [], `raw colour values outside a :root block: ${kept.join(', ')}`);
});

test('stylesheet: every custom property is actually used', () => {
  const declared = [...new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]))];
  const consumed = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]));
  const unused = declared
    .filter((token) => !consumed.has(token) && !JS_OWNED.has(token) && !RESERVED.has(token))
    .sort();
  assert.deepEqual(unused, [], `declared but unused tokens: ${unused.join(', ')}`);
});

test('stylesheet: no malformed declarations sneak through', () => {
  // A hex value must be contiguous; `#26262 5` style typos parse as nothing and
  // leave a rule silently unstyled.
  const declarations = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([a-z-]+)\s*:\s*([^;{}]+)[;}]/g)];
  assert.ok(declarations.length > 300, `declarations parsed: ${declarations.length}`);

  for (const [, property, value] of declarations) {
    const trimmed = value.trim();
    assert.ok(trimmed.length > 0, `${property} has a value`);
    assert.ok(!/^\s*#[0-9a-f]*\s+[0-9a-f]+\s*$/i.test(trimmed), `malformed hex value in "${property}: ${trimmed}"`);
  }

  // Every screen font-size is either a token or a clamp(): no new ad-hoc sizes.
  // Print rules may name physical units, which is what `pt` is for on paper.
  const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim());
  assert.ok(sizes.length > 30, `font sizes parsed: ${sizes.length}`);
  const offScale = sizes.filter((size) => !/^var\(--fs-|^clamp\(|^[\d.]+pt$/.test(size));
  assert.deepEqual(offScale, [], `font sizes outside the scale: ${offScale.join(', ')}`);
});

test('stylesheet: no token resolves to itself', () => {
  // `--nav-bg: var(--nav-bg)` is valid CSS that computes to nothing, so the
  // declaration silently vanishes and the component loses its background.
  // A self-reference is never intentional here, so fail loudly.
  for (const { name, source } of PAGE_FILES) {
    const selfReferential = [...source.matchAll(/(--[\w-]+)\s*:\s*var\(\s*(--[\w-]+)\s*\)/g)]
      .filter((match) => match[1] === match[2])
      .map((match) => match[1]);
    assert.deepEqual(selfReferential, [], `${name}: token declares itself: ${selfReferential.join(', ')}`);
  }
});

test('stylesheet: assets and external references stay relative', () => {
  // data: URIs are inline; anything else must be a relative path (the site is
  // served from /portfolio-proj-update/, so root-absolute URLs 404).
  for (const { name, source } of PAGE_FILES) {
    for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const url = match[1];
      if (url.startsWith('data:')) continue;
      assert.ok(!/^https?:/i.test(url), `${name}: remote asset referenced from CSS: ${url}`);
      assert.ok(!url.startsWith('/'), `${name}: root-absolute asset path in CSS: ${url}`);
    }
  }
  const cssDir = path.dirname(stylePath.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  assert.ok(!fs.existsSync(path.join(cssDir, 'site.css')), 'no stale site.css');
});

test('stylesheet: regression guards for bugs the audit found', () => {
  // The honeypot wrapper has both classes on one element; a descendant selector
  // matched nothing and left a visible "Company" field that dropped real messages.
  assert.ok(/\.form-field\.hp\s*\{/.test(page), 'the honeypot rule targets .form-field.hp');
  assert.ok(!/\.form-field\s+\.hp\b/.test(page), 'and not a descendant that does not exist');

  // main.js toggles this class; with no rule behind it the dot stayed over the "Open" label.
  assert.ok(/\.cursor\.is-hidden\s*\{/.test(page), 'the cursor dot has an is-hidden state');

  // Interactive elements that set cursor:pointer must still lose it under the custom cursor.
  for (const selector of ['.project-card', '.hero-feature', '.project-case-open']) {
    assert.ok(new RegExp(`html\\.has-cursor\\s+${selector.replace('.', '\\.')}\\b`).test(page), `${selector} keeps cursor:none`);
  }

  // Hovered primary buttons swap their fill, so their text must follow it.
  assert.ok(/\.hero-cta:hover\s*\{[^}]*color:\s*var\(--paper\)/.test(page), '.hero-cta:hover sets its own text colour');
  assert.ok(/\.form-submit:hover:not\(:disabled\)\s*\{[^}]*color:\s*var\(--paper\)/.test(page), '.form-submit:hover sets its own text colour');
  assert.ok(/\.resume-print:hover\s*\{[^}]*color:\s*var\(--paper\)/.test(resume), '.resume-print:hover sets its own text colour');

  // The certificate cards no longer flip dark, so their hover text must not stay light.
  assert.ok(/\.cert-card:hover \.cert-name,\s*\.cert-card:focus-within \.cert-name\s*\{\s*color:\s*var\(--ink\)/.test(page),
    'certificate names stay readable on hover');

  // résumé.css does not load style.css, so it needs its own reset.
  assert.ok(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*margin:\s*0;[^}]*padding:\s*0/.test(resume), 'resume.css resets margins and padding');

  // Dead code that was removed should stay removed.
  assert.ok(!page.includes('hero-capability'), 'the old capability chips are gone');
  assert.ok(!/data-contrast/.test(tokens), 'the never-toggled high-contrast override is gone');
  assert.ok(/\.js\.no-dialog\s+\.project-case-open\s*\{\s*display:\s*none/.test(page), 'dead openers are hidden when dialogs are unsupported');
  assert.ok(/\.notfound-page\s+\.nav-cta\s*\{\s*display:\s*inline-flex/.test(page), 'pages with no hamburger keep the résumé link on mobile');
});
