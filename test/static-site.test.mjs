// Retrieval safety net: a crawler or a visitor who lands somewhere unexpected
// still has somewhere to go. These are the files that make that true, and they
// are the easiest things in the repo to break silently (a typo'd host, a route
// that no longer exists, a sitemap full of 404s).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const read = (name) => fs.readFileSync(`../${name}`, 'utf8');
const SITE_PATH = '/portfolio-proj-update/';
const SITE = 'https://arfzkwn-coder.github.io/portfolio-proj-update';

test('robots.txt allows crawling and points at the sitemap that exists', () => {
  const robots = read('robots.txt');
  assert.match(robots, /^User-agent:\s*\*/m, 'a wildcard user-agent group');
  assert.match(robots, /^Allow:\s*\/\s*$/m, 'crawling is allowed by default');
  assert.ok(!/^Disallow:\s*\/\s*$/m.test(robots), 'the whole site is not disallowed');

  const declared = robots.match(/^Sitemap:\s*(\S+)$/m);
  assert.ok(declared, 'robots.txt declares a sitemap');
  assert.equal(declared[1], `${SITE}/sitemap.xml`, 'the sitemap URL matches the canonical host');
  assert.ok(fs.existsSync('../sitemap.xml'), 'the declared sitemap really exists');
});

test('sitemap.xml lists only pages that exist, on the canonical host', () => {
  const xml = read('sitemap.xml');
  assert.equal((xml.match(/<urlset/g) || []).length, 1, 'one urlset');
  assert.equal((xml.match(/<\/url>/g) || []).length, (xml.match(/<url>/g) || []).length, 'every url is closed');

  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(urls.sort(),
    [`${SITE}/`, `${SITE}/privacy.html`, `${SITE}/resume.html`],
    'every real document is listed, and nothing else');

  for (const url of urls) {
    const file = url.endsWith('/') ? 'index.html' : url.slice(SITE.length + 1);
    assert.ok(fs.existsSync(`../${file}`), `sitemap entry resolves to a real file: ${file}`);
  }

  // A lastmod is a claim; every entry must make one and it must be a real date.
  const lastmods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((match) => match[1]);
  assert.equal(lastmods.length, urls.length, 'every entry carries a lastmod');
  for (const date of lastmods) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/, `lastmod is an ISO date: ${date}`);
    assert.ok(!Number.isNaN(Date.parse(date)), `lastmod parses: ${date}`);
  }
});

test('404.html is self-contained, no-indexed, and points back to the site', () => {
  const html = read('404.html');
  const { document } = new JSDOM(html).window;

  assert.equal(document.querySelector('meta[name="robots"]').getAttribute('content'), 'noindex',
    'a 404 must not be indexed');
  // Pages serves this file from arbitrary depths, so relative assets need a base.
  assert.equal(document.querySelector('base').getAttribute('href'), SITE_PATH,
    'the base pins relative links to the site root');

  const links = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  assert.ok(links.includes('index.html'), 'offers the portfolio');
  assert.ok(links.includes('resume.html'), 'offers the résumé');
  for (const link of links) {
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    assert.ok(fs.existsSync(`../${link}`), `404 link resolves to a real file: ${link}`);
  }

  assert.ok(document.querySelector('link[href="css/tokens.css"]'), 'uses the shared tokens');
  assert.ok(document.querySelector('link[href="css/style.css"]'), 'uses the page stylesheet');
  assert.ok(document.querySelector('main#main'), 'has a main landmark for the skip link');
});

test('.nojekyll is present so Pages copies underscored files verbatim', () => {
  assert.ok(fs.existsSync('../.nojekyll'), 'a build step must not rewrite the site');
});

test('the canonical host matches the repository the site deploys from', () => {
  // A Pages project site is served from /<repo>/, so renaming the repo — or
  // copying the site into a differently named one — invalidates every absolute
  // URL at once (canonical, og:url, og:image, sitemap, robots, the 404 base).
  // That failure is invisible locally, so tie the constant to the actual remote.
  const remote = (() => {
    try {
      return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: '..', encoding: 'utf8' }).trim();
    } catch {
      return ''; // no git (e.g. a source tarball): there is nothing to compare against
    }
  })();
  const match = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!match) return;
  const [, owner, repo] = match;

  // In a fork's CI the origin is the fork, so the host legitimately differs.
  // Only the canonical owner's own repository has to agree with the constants.
  const canonicalOwner = new URL(SITE).hostname.split('.')[0];
  if (process.env.GITHUB_REPOSITORY && owner.toLowerCase() !== canonicalOwner) return;

  assert.equal(SITE, `https://${owner.toLowerCase()}.github.io/${repo}`,
    'absolute URLs must use the deployed repository name; update the HTML, sitemap, robots.txt and 404 <base> together');
});
