// Retrieval safety net: a crawler or a visitor who lands somewhere unexpected
// still has somewhere to go. These are the files that make that true, and they
// are the easiest things in the repo to break silently (a typo'd host, a route
// that no longer exists, a sitemap full of 404s).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (name) => fs.readFileSync(`../${name}`, 'utf8');
const SITE_PATH = '/portfolio-proj-update/';
const SITE = 'https://docs-publisher.tail62b6df.ts.net/portfolio-proj-update';

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

test('the canonical URL lives under the same path the 404 <base> pins', () => {
  // nginx serves the site from /portfolio-proj-update/ behind Tailscale Funnel.
  // Moving it invalidates every absolute URL at once (canonical, og:url,
  // og:image, sitemap, robots) and the 404 base, so they must move together.
  assert.equal(`${new URL(SITE).pathname}/`, SITE_PATH,
    'update the HTML, sitemap, robots.txt and 404 <base> together');
});

test('the ZimaOS deploy ships every file the pages load, and nothing private', () => {
  // The deploy job copies an explicit list, so a new top-level folder the pages
  // start loading would silently 404 in production unless it is added here too.
  const workflow = read('.github/workflows/ci.yml');
  const copy = workflow.match(/cp -r (.+) \/deploy\//);
  assert.ok(copy, 'the deploy job copies the site into /deploy/');
  const shipped = copy[1].trim().split(/\s+/);

  for (const entry of shipped) assert.ok(fs.existsSync(`../${entry}`), `deploy list entry exists: ${entry}`);
  for (const secret of ['test', 'relay', 'node_modules', 'package.json', 'README.md', '.github']) {
    assert.ok(!shipped.includes(secret), `${secret} is not published`);
  }

  const needed = new Set(['robots.txt', 'sitemap.xml', 'og-image.png']);
  for (const page of ['index.html', 'resume.html', 'privacy.html', '404.html']) {
    needed.add(page);
    const { document } = new JSDOM(read(page)).window;
    for (const el of document.querySelectorAll('[href], [src]')) {
      const ref = el.getAttribute('href') ?? el.getAttribute('src');
      if (!ref || /^(https?:|data:|mailto:|tel:|#|\/)/.test(ref)) continue;
      needed.add(ref.split(/[/?#]/)[0]);
    }
  }
  for (const css of fs.readdirSync('../css')) {
    for (const [, url] of read(`css/${css}`).matchAll(/url\(\s*['"]?\.\.\/([^/'")]+)/g)) needed.add(url);
  }
  for (const entry of needed) {
    if (entry) assert.ok(shipped.includes(entry), `the deploy publishes ${entry}, which the site loads`);
  }
});
