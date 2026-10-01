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
const tokensPath = new URL('../css/tokens.css', import.meta.url);
const stylePath = new URL('../css/style.css', import.meta.url);
const resumePath = new URL('../css/resume.css', import.meta.url);
const tokens = fs.readFileSync(tokensPath, 'utf8');
const page = fs.readFileSync(stylePath, 'utf8');
const resume = fs.readFileSync(resumePath, 'utf8');
const css = `${tokens}\n${page}\n${resume}`;
const PAGE_FILES = [
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

// Custom properties that JavaScript owns: it writes them with setProperty and
// the stylesheet only ever reads them. Keeping the list explicit means a typo
// in a static var() still fails the suite.
const JS_OWNED = new Set(['--i', '--x', '--y', '--mx', '--my', '--nav-progress']);

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
  // Every colour belongs in a :root block: the shared tokens, the dark-scheme
  // override, or resume.css's print override. Strip those (and the whole print
  // block, whose literal black-on-white values are the point of printing), plus
  // any embedded SVG data URI, and nothing below them may still name a colour.
  const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');
  const kept = [];
  for (const { name, source } of PAGE_FILES) {
    let stripped = withoutComments(source).replace(/:root\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, '');
    if (name.endsWith('resume.css')) stripped = stripped.replace(/@media\s+print\s*\{[\s\S]*\n\}/, '');
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
  // served from /portfolio-proj/, so root-absolute URLs 404).
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
