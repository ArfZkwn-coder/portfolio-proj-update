// Structural guards for the stylesheet. The contrast suite proves the colours
// are legible; this one proves the file itself is well-formed and that every
// var() reference resolves, which is what a typo would silently break.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const cssPath = new URL('../css/style.css', import.meta.url);
const css = fs.readFileSync(cssPath, 'utf8');

test('stylesheet: braces are balanced and the token block opens the file', () => {
  let depth = 0;
  for (const character of css) {
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    assert.ok(depth >= 0, 'a closing brace appears before its opening brace');
  }
  assert.equal(depth, 0, 'every brace is closed');
  assert.ok(css.trimStart().startsWith('*'), 'the reset still leads the file');
  assert.ok(css.includes('1. DESIGN TOKENS'), 'the token section is documented');
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

  // Every font-size is either a token or a clamp(): no new ad-hoc sizes.
  const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim());
  assert.ok(sizes.length > 30, `font sizes parsed: ${sizes.length}`);
  const offScale = sizes.filter((size) => !/^var\(--fs-|^clamp\(/.test(size));
  assert.deepEqual(offScale, [], `font sizes outside the scale: ${offScale.join(', ')}`);
});

test('stylesheet: assets and external references stay relative', () => {
  // data: URIs are inline; anything else must be a relative path (the site is
  // served from /portfolio-proj/, so root-absolute URLs 404).
  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    const url = match[1];
    if (url.startsWith('data:')) continue;
    assert.ok(!/^https?:/i.test(url), `remote asset referenced from CSS: ${url}`);
    assert.ok(!url.startsWith('/'), `root-absolute asset path in CSS: ${url}`);
  }
  assert.ok(!fs.existsSync(path.join(path.dirname(cssPath.pathname), 'site.css')), 'no stale site.css');
});
