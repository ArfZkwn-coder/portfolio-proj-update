// Automated accessibility pass over the shipped markup.
//
// test/contrast.test.mjs proves the palette is legible and test/main.smoke.test.mjs
// proves the interactive plumbing, but neither catches structural mistakes a tool
// can see (content outside a landmark, an unnamed control, a bad ARIA reference).
// axe-core does, so a regression in the markup fails here instead of in the wild.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const axeSource = fs.readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const PAGES = ['index.html', 'resume.html', 'privacy.html', '404.html'];

// Contrast needs real layout and a real canvas, neither of which jsdom has.
// test/contrast.test.mjs computes every pair exactly, so axe is not asked to.
const NEEDS_LAYOUT = ['color-contrast'];

function loadPage(file) {
  const html = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  // A silent console: jsdom cannot rasterise, and axe probes for that.
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: `https://docs-publisher.tail62b6df.ts.net/portfolio-proj-update/${file === 'index.html' ? '' : file}`,
    virtualConsole,
  });
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  dom.window.eval(axeSource);
  return dom;
}

for (const file of PAGES) {
  test(`a11y: ${file} passes axe-core`, async () => {
    const dom = loadPage(file);
    try {
      const results = await dom.window.axe.run(dom.window.document, {
        resultTypes: ['violations'],
        rules: Object.fromEntries(NEEDS_LAYOUT.map((id) => [id, { enabled: false }])),
      });
      // Array.from, not .map(): the results came from the jsdom realm, and a
      // cross-realm array fails deepStrictEqual against a Node array.
      const found = Array.from(results.violations, (violation) => {
        const where = violation.nodes.map((node) => node.target.join(' ')).join(' | ');
        return `${violation.id} [${violation.impact}] ${violation.help} -> ${where}`;
      });
      assert.deepEqual(found, [], `axe-core found ${found.length} violation(s):\n${found.join('\n')}`);
    } finally {
      dom.window.close();
    }
  });
}
