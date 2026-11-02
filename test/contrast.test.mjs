// Guards the palette in css/tokens.css against WCAG 2.1 AA regression.
//
// The token file is the single source of truth for colour: tokens are read out
// of the `:root` blocks by name, so changing a hex there re-runs these checks.
// Thresholds: 4.5:1 for normal body text, 3:1 for large text (>=18.66px bold or
// >=24px) and for non-text UI such as borders, dots and focus rings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
// Comments can contain braces and semicolons, so drop them before parsing.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ------------------------------------------------------------------ */
/* CSS token extraction                                                */
/* ------------------------------------------------------------------ */

// Pulls the custom properties out of `:root { ... }` blocks in the given
// source, in order, so later declarations win the same way the cascade does.
function readRootTokens(source) {
  const tokens = {};
  const rootBlock = /:root\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g;
  for (const match of source.matchAll(rootBlock)) {
    for (const declaration of match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens[declaration[1]] = declaration[2].trim();
    }
  }
  return tokens;
}

// Returns the full text of a top-level `@media (...) { ... }` block.
function mediaBlock(source, mediaQuery) {
  const start = source.indexOf(`@media ${mediaQuery}`);
  assert.ok(start !== -1, `@media ${mediaQuery} block exists`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced @media ${mediaQuery} block`);
}

const DARK_MEDIA = '(prefers-color-scheme: dark)';
const darkBlock = mediaBlock(cssNoComments, DARK_MEDIA);
// The light palette is everything outside the dark block; the dark palette is
// the light one with the block's overrides layered on top.
const light = readRootTokens(cssNoComments.replace(darkBlock, ''));
const dark = { ...light, ...readRootTokens(darkBlock) };
assert.equal(light['--ink'], '#0f0f0f', 'light --ink read from the base :root block');
assert.equal(dark['--paper'], '#121212', 'dark --paper read from the media block');

const HEX = /^#[0-9a-f]{3,8}$/i;

function luminance(hex) {
  assert.ok(HEX.test(hex), `"${hex}" is a hex colour`);
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map((c) => c + c).join('') : digits;
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ------------------------------------------------------------------ */
/* Light scheme                                                        */
/* ------------------------------------------------------------------ */

// [foreground token, background token, minimum ratio, why]
const PAIRS = [
  ['--ink', '--paper', 4.5, 'headings and body on the page background'],
  ['--ink', '--card', 4.5, 'text on the alternating cream sections'],
  ['--text-body', '--paper', 4.5, 'paragraph copy on paper'],
  ['--text-body', '--card', 4.5, 'paragraph copy on card'],
  ['--muted', '--paper', 4.5, 'uppercase micro-labels on paper'],
  ['--muted', '--card', 4.5, 'uppercase micro-labels on card'],
  ['--accent', '--paper', 4.5, 'small accent text: hero label, section numbers'],
  ['--accent', '--card', 4.5, 'small accent text on cream sections'],
  ['--accent-strong', '--paper', 4.5, 'pressed/hover accent text'],
  ['--accent-strong', '--card', 4.5, 'pressed/hover accent text on cream sections'],
  ['--accent-on-dark', '--ink', 4.5, 'accent text on the inverted skills/footer surfaces'],
  ['--accent-bright', '--ink', 4.5, 'bright accent on dark surfaces (rules, dots, 3D)'],
  ['--text-on-dark', '--ink', 4.5, 'light text on dark surfaces'],
  ['--text-on-dark', '--ink-raised', 4.5, 'light text on dark cards'],
  ['--muted-dark', '--ink-raised', 4.5, 'muted text in dark cards'],
  ['--text-faint-dark', '--ink-raised', 4.5, 'skill descriptions'],
  ['--ok-text', '--ok-bg', 4.5, 'success form status'],
  ['--error-text', '--error-bg', 4.5, 'error form status and inline field errors'],
  ['--error-text', '--paper', 4.5, 'inline field error under an input'],
  ['--solid-text', '--solid', 4.5, 'text on the fixed dark fill (buttons, inverted panels)'],
  ['--accent-on-dark', '--solid', 4.5, 'accent text on the fixed dark skills panel'],
  ['--muted-dark', '--solid', 4.5, 'muted text on the fixed dark skills panel'],
  ['--text-on-dark', '--solid', 4.5, 'light text on the fixed dark skills panel'],
  ['--dialog-text', '--dialog-surface', 4.5, 'case-study dialog body copy'],
  ['--muted', '--dialog-surface', 4.5, 'case-study dialog labels and stack tags'],
  ['--accent', '--dialog-surface', 4.5, 'case-study dialog accents and links'],
  ['--live', '--card', 3, 'availability dot is a non-text indicator'],
  ['--accent', '--paper', 3, 'focus ring: non-text UI'],
  ['--line-strong', '--paper', 1.5, 'section rules and input borders stay perceptible'],
];

for (const [foreground, background, minimum, why] of PAIRS) {
  test(`contrast: ${foreground} on ${background} meets ${minimum}:1 (${why})`, () => {
    assert.ok(light[foreground], `${foreground} is declared in :root`);
    assert.ok(light[background], `${background} is declared in :root`);
    const value = ratio(light[foreground], light[background]);
    assert.ok(
      value >= minimum,
      `${foreground} (${light[foreground]}) on ${background} (${light[background]}) is ${value.toFixed(2)}:1, needs ${minimum}:1`
    );
  });
}

/* ------------------------------------------------------------------ */
/* Dark scheme                                                         */
/* ------------------------------------------------------------------ */

const DARK_PAIRS = [
  ['--ink', '--paper', 4.5, 'text on the dark page background'],
  ['--ink', '--card', 4.5, 'text on dark alternating sections'],
  ['--text-body', '--paper', 4.5, 'paragraph copy in dark mode'],
  ['--text-body', '--card', 4.5, 'paragraph copy on dark cards'],
  ['--text-body', '--section-alt', 4.5, 'paragraph copy on dark alternating bands'],
  ['--muted', '--paper', 4.5, 'micro-labels in dark mode'],
  ['--muted', '--section-alt', 4.5, 'micro-labels on dark alternating bands'],
  ['--accent', '--paper', 4.5, 'accent text in dark mode'],
  ['--accent', '--section-alt', 4.5, 'accent text on dark alternating bands'],
  ['--ok-text', '--ok-bg', 4.5, 'success status in dark mode'],
  ['--error-text', '--error-bg', 4.5, 'error status in dark mode'],
  ['--error-text', '--paper', 4.5, 'inline field error in dark mode'],
  ['--solid-text', '--solid', 4.5, 'text on the fixed dark fill in dark mode'],
  ['--text-on-dark', '--solid', 4.5, 'light text on the fixed dark skills panel'],
  ['--dialog-text', '--dialog-surface', 4.5, 'case-study dialog body copy in dark mode'],
  ['--muted', '--dialog-surface', 4.5, 'case-study dialog labels in dark mode'],
  ['--accent', '--dialog-surface', 4.5, 'case-study dialog accents in dark mode'],
  ['--live', '--card', 3, 'availability dot in dark mode'],
];

for (const [foreground, background, minimum, why] of DARK_PAIRS) {
  test(`dark scheme contrast: ${foreground} on ${background} meets ${minimum}:1 (${why})`, () => {
    const value = ratio(dark[foreground], dark[background]);
    assert.ok(
      value >= minimum,
      `${foreground} (${dark[foreground]}) on ${background} (${dark[background]}) is ${value.toFixed(2)}:1, needs ${minimum}:1`
    );
  });
}

/* ------------------------------------------------------------------ */
/* Token hygiene                                                       */
/* ------------------------------------------------------------------ */

test('tokens: every colour token is a literal hex, and the accent tiers stay distinct', () => {
  const colourTokens = Object.entries(light).filter(([, value]) => /^#[0-9a-f]{3,8}$/i.test(value));
  assert.ok(colourTokens.length >= 15, `colour tokens declared: ${colourTokens.length}`);
  // The text accent must be darker than the bright decorative accent, or the
  // small-text contrast checks above would not be meaningful.
  assert.ok(luminance(light['--accent']) < luminance(light['--accent-bright']), '--accent is darker than --accent-bright');
});

test('stylesheet: the token contract above is complete', () => {
  const required = [
    '--paper', '--card', '--ink', '--ink-raised', '--ink-line',
    '--solid', '--solid-text', '--section-alt',
    '--muted', '--text-body', '--muted-dark', '--text-on-dark', '--text-faint-dark',
    '--accent', '--accent-strong', '--accent-bright', '--accent-on-dark', '--accent-tint',
    '--line', '--line-strong',
    '--ok-bg', '--ok-border', '--ok-text', '--error-bg', '--error-border', '--error-text', '--live',
    '--scrim', '--dialog-surface', '--dialog-text', '--nav-bg', '--nav-bg-solid',
    '--space-2', '--space-8', '--pad-inline', '--pad-section', '--nav-h', '--radius',
    '--dur-fast', '--dur-base', '--ease-out',
    '--fs-2xs', '--fs-xs', '--fs-sm', '--fs-base', '--fs-lg', '--fs-xl', '--fs-2xl', '--fs-3xl', '--fs-5xl', '--fs-6xl',
    '--font-display', '--font-body',
  ];
  const missing = required.filter((token) => !light[token]);
  assert.deepEqual(missing, [], `tokens missing from :root: ${missing.join(', ')}`);
});

/* ------------------------------------------------------------------ */
/* Translucent surfaces                                                */
/* ------------------------------------------------------------------ */

// The scrolled nav bar is the one translucent surface that carries text, so it
// needs a value per scheme. Skipping the dark override once shipped a cream bar
// over the dark page, with links on it at roughly 1.1:1.
function parseColour(value) {
  const rgba = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/);
  if (rgba) {
    return {
      channels: [1, 2, 3].map((index) => Number(rgba[index])),
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  assert.ok(HEX.test(value), `"${value}" is a hex or rgb()/rgba() colour`);
  const digits = value.slice(1);
  const full = digits.length === 3 ? [...digits].map((c) => c + c).join('') : digits;
  return { channels: [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)), alpha: 1 };
}

// Flattens a translucent token onto whatever sits behind it, the way the
// browser paints it.
function composited(value, background) {
  const { channels, alpha } = parseColour(value);
  const under = parseColour(background).channels;
  const mixed = channels.map((channel, index) => Math.round(channel * alpha + under[index] * (1 - alpha)));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

test('tokens: the nav bar background flips with the scheme', () => {
  assert.ok(parseColour(light['--nav-bg']).alpha < 1, '--nav-bg stays translucent so content blurs through');
  assert.notEqual(
    light['--nav-bg-solid'],
    dark['--nav-bg-solid'],
    '--nav-bg-solid is remapped in the dark block'
  );
  const lightBar = luminance(composited(light['--nav-bg'], light['--paper']));
  const darkBar = luminance(composited(dark['--nav-bg'], dark['--paper']));
  assert.ok(darkBar < lightBar, 'the dark nav bar composites darker than the light one, not cream');
});

for (const [scheme, palette] of [['light', light], ['dark', dark]]) {
  test(`${scheme}: nav text stays readable on the scrolled bar`, () => {
    const bar = composited(palette['--nav-bg'], palette['--paper']);
    for (const [foreground, why] of [['--ink', 'logo and active link'], ['--muted', 'idle links']]) {
      const value = ratio(palette[foreground], bar);
      assert.ok(
        value >= 4.5,
        `${scheme}: ${foreground} (${palette[foreground]}) on the nav bar (${bar}) is ${value.toFixed(2)}:1, needs 4.5:1 (${why})`
      );
    }
  });
}
