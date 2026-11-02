// Guards the deploy-time facts that unit tests can't see: the site is served from a sub-path
// (/portfolio-proj-update/), so asset paths must be relative, and no placeholder may ship.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync('../index.html', 'utf8');
const { document } = new JSDOM(html).window;
const SITE = 'https://docs-publisher.tail62b6df.ts.net/portfolio-proj-update';

test('all local assets are relative (root-absolute paths 404 on a Pages project site) and exist on disk', () => {
  const localRefs = (doc) => [...doc.querySelectorAll('link[href], script[src]')]
    .map((el) => el.getAttribute('href') || el.getAttribute('src'))
    .filter((u) => u && !/^(https?:|data:|#|mailto:)/.test(u));

  const refs = localRefs(document);
  assert.deepEqual(refs.sort(), ['css/fonts.css', 'css/style.css', 'css/tokens.css', 'js/main.js', 'js/tracking.js']);

  // resume.html is a second document the repo must ship consistently.
  const resumeHtml = fs.readFileSync('../resume.html', 'utf8');
  const resumeDoc = new JSDOM(resumeHtml).window.document;
  assert.deepEqual(localRefs(resumeDoc).sort(), ['css/fonts.css', 'css/resume.css', 'css/tokens.css', 'js/tracking.js']);

  // main.js is a classic script that loads nothing lazily: every file the page
  // needs is listed above.
  assert.ok(!/import\(/.test(fs.readFileSync('../js/main.js', 'utf8')), 'main.js imports no module at runtime');
  for (const ref of [...refs, ...localRefs(resumeDoc)]) {
    assert.ok(!ref.startsWith('/'), `root-absolute path breaks under /portfolio-proj-update/: ${ref}`);
    assert.ok(!ref.includes('site/'), `stale site/ subfolder reference: ${ref}`);
    assert.ok(fs.existsSync(`../${ref}`), `missing file for ${ref}`);
  }
});

test('social/SEO metadata is absolute and the og-image is a real PNG', () => {
  const meta = (p) => document.querySelector(`meta[property="${p}"]`)?.getAttribute('content');
  assert.equal(meta('og:url'), `${SITE}/`);
  assert.equal(meta('og:image'), `${SITE}/og-image.png`);
  assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), `${SITE}/`);
  const png = fs.readFileSync('../og-image.png');
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'og-image.png has a PNG signature');
  const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(ld['@type'], 'Person'); assert.equal(ld.name, 'Arif Zakwan');
});

test('fonts are self-hosted: no page reaches out to a third-party font origin', () => {
  // The webfonts live in fonts/ and are declared in css/fonts.css. A stray
  // fonts.googleapis.com link would quietly reintroduce a third-party request
  // (and a render-blocking stylesheet) without breaking anything visibly.
  for (const file of ['index.html', 'resume.html', 'privacy.html', '404.html']) {
    const source = fs.readFileSync(`../${file}`, 'utf8');
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(source), `${file} loads fonts from Google`);
    assert.match(source, /href="css\/fonts\.css"/, `${file} loads the self-hosted @font-face sheet`);
  }
  for (const face of ['dm-sans-latin.woff2', 'dm-serif-display-latin.woff2', 'dm-serif-display-italic-latin.woff2']) {
    assert.ok(fs.existsSync(`../fonts/${face}`), `fonts/${face} ships`);
  }
});

test('no placeholder content ships: no example.com links, no hidden credential links, no TODO text', () => {
  assert.ok(!/example\.com/.test(html), 'example.com placeholder URL found');
  assert.equal(document.querySelectorAll('.cert-verify[hidden]').length, 0);
  assert.ok(!/\bTODO\b/.test(document.body.textContent));
  for (const a of document.querySelectorAll('.cert-verify')) assert.match(a.getAttribute('href'), /^https:\/\//);
});

test('stack: all six skills are listed under About, including the real Linux skill', () => {
  const items = [...document.querySelectorAll('#about #skills .stack-item')];
  assert.equal(items.length, 6);
  const names = items.map((item) => item.querySelector('.stack-name').textContent.trim());
  assert.ok(names.includes('Linux System Administration'));
  assert.ok(!names.some((n) => /Next\.js/.test(n)), 'stale Next.js placeholder skill');
  for (const item of items) {
    assert.ok(item.querySelector('.stack-tag').textContent.trim(), 'every skill carries a tag');
    assert.ok(item.querySelector('.stack-desc').textContent.trim().length > 20, 'every skill says what it covers');
  }
});

test('real experience, certification and project content is intact', () => {
  const text = document.body.textContent.replace(/\s+/g, ' ');
  for (const needle of ['Team Fames Sdn Bhd', 'Universiti Teknologi MARA (UiTM)', 'Diploma in Computer Science', 'S&S Hana Enterprise', 'AqWise', 'Google Data Analytics Professional Certificate', 'Personal Homelab & Game Server', 'Docs Publisher MCP Connector']) {
    assert.ok(text.includes(needle), `missing: ${needle}`);
  }
  assert.equal(document.querySelectorAll('.timeline-item').length, 3);
  assert.equal(document.querySelectorAll('.cert-card').length, 3, '2 degrees + 1 certificate');
  assert.equal(document.querySelectorAll('.cert-verify').length, 1, 'only the certificate has a verify link');
  assert.equal(document.querySelectorAll('.project-card').length, 3);
  // The years-of-experience figure lives in one place now (the proof strip);
  // it once read "1" in one section and "3+" in another.
  const years = [...document.querySelectorAll('.proof-stat')].find((stat) => /year/.test(stat.textContent));
  assert.equal(years.querySelector('.proof-value').textContent.trim(), '1+');
  assert.equal(document.querySelectorAll('.about-fact, .impact-stat').length, 0, 'no second copy of the stats');
});

test('accessibility plumbing ships with the markup', () => {
  // The icon-only menu button has no text, so it needs a name of its own.
  const hamburger = document.getElementById('hamburger');
  assert.ok(hamburger.getAttribute('aria-label'), 'hamburger has an accessible name');
  assert.equal(hamburger.getAttribute('aria-controls'), 'mobileMenu');
  assert.notEqual(hamburger.getAttribute('tabindex'), '-1', 'menu button stays reachable');

  const menu = document.getElementById('mobileMenu');
  assert.equal(menu.getAttribute('role'), 'dialog', 'the overlay is announced as a dialog');
  assert.equal(menu.getAttribute('aria-modal'), 'true');
  assert.ok(menu.hasAttribute('inert'), 'closed menu is inert until opened');

  // Decorative icons must not be announced or focusable. An informative
  // diagram is the one exception, and it must carry a name of its own instead.
  const svgs = [...document.querySelectorAll('svg')];
  assert.ok(svgs.length >= 6, `icons present: ${svgs.length}`);
  for (const svg of svgs) {
    if (svg.getAttribute('role') === 'img') {
      assert.ok(svg.getAttribute('aria-label'), 'a labelled diagram has an accessible name');
      continue;
    }
    assert.equal(svg.getAttribute('aria-hidden'), 'true', 'decorative svg is aria-hidden');
    assert.equal(svg.getAttribute('focusable'), 'false', 'decorative svg is not focusable');
    assert.equal(svg.getAttribute('stroke'), 'currentColor', 'icon stroke follows the accent token');
  }

  // Required inputs describe themselves and own an error slot.
  for (const id of ['fname', 'femail', 'fmessage']) {
    const field = document.getElementById(id);
    const describedBy = field.getAttribute('aria-describedby');
    assert.ok(describedBy, `${id} has aria-describedby`);
    const error = document.getElementById(describedBy);
    assert.ok(error, `${id} points at a real error element`);
    assert.ok(error.hasAttribute('hidden'), `${id} error starts hidden`);
    assert.ok(error.textContent.trim().length > 0, `${id} error has copy without JS`);
  }
  assert.equal(document.getElementById('contactForm').hasAttribute('novalidate'), true, 'inline validation owns the messages');
});

test('résumé: reachable from the portfolio in one step, and cross-linked back', () => {
  // Entry points on the portfolio page. The nav button sits outside .nav-links
  // on purpose, so the on-page section order the tests above enforce is
  // untouched by a link to another document.
  assert.equal(document.querySelector('.nav-cta').getAttribute('href'), 'resume.html', 'nav offers the résumé');
  assert.equal(document.querySelector('.hero-cta-tertiary').getAttribute('href'), 'resume.html', 'hero offers the résumé');
  assert.equal(document.querySelector('.contact-resume a').getAttribute('href'), 'resume.html', 'contact offers the résumé');

  const resumeDoc = new JSDOM(fs.readFileSync('../resume.html', 'utf8')).window.document;
  assert.equal(resumeDoc.querySelector('.resume-bar-link').getAttribute('href'), 'index.html', 'the résumé links back');
  assert.ok(resumeDoc.querySelector('.resume-print'), 'the résumé offers a print/PDF control');
  assert.equal(resumeDoc.querySelector('link[rel="canonical"]').getAttribute('href'), `${SITE}/resume.html`);

  // The résumé must reproduce the real content, not a summary that drifts.
  const text = resumeDoc.body.textContent.replace(/\s+/g, ' ');
  for (const needle of ['Team Fames Sdn Bhd', 'S&S Hana Enterprise', 'AqWise', 'Universiti Teknologi MARA (UiTM)',
    'Google Data Analytics Professional Certificate', 'Linux System Administration', 'Arif Zakwan']) {
    assert.ok(text.includes(needle), `résumé is missing: ${needle}`);
  }
  // 3 roles + 3 projects + 2 degrees + 1 certificate
  assert.equal(resumeDoc.querySelectorAll('.resume-entry').length, 9, 'every real entry is carried over');

  // No screen-only chrome should print. .resume-chrome is the banner that wraps
  // the toolbar row and its hint, so hiding it covers both.
  const resumeCss = fs.readFileSync('../css/resume.css', 'utf8');
  const printBlock = resumeCss.slice(resumeCss.indexOf('@media print'));
  for (const selector of ['.resume-chrome', '.skip-link']) {
    assert.ok(printBlock.includes(selector), `print rules hide ${selector}`);
  }
  assert.ok(/@page\s*\{[^}]*size:\s*A4/.test(printBlock), 'print declares an A4 page');
});

test('structured data: both pages publish the same person', () => {
  const person = (doc) => JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
  const fromRoot = person(document);
  const fromResume = person(new JSDOM(fs.readFileSync('../resume.html', 'utf8')).window.document);

  assert.equal(fromResume.name, fromRoot.name, 'the same name');
  assert.equal(fromResume.jobTitle, fromRoot.jobTitle, 'the same job title');
  assert.deepEqual(fromResume.sameAs, fromRoot.sameAs, 'the same profile links');
  assert.ok(fromResume.url.startsWith(SITE), 'the résumé links back to the portfolio');
});

test('privacy: the page exists, is reachable, and is honest about what is collected', () => {
  const html = fs.readFileSync('../privacy.html', 'utf8');
  const doc = new JSDOM(html).window.document;

  assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute('href'), `${SITE}/privacy.html`);
  for (const page of ['index.html', 'resume.html', '404.html']) {
    const source = fs.readFileSync(`../${page}`, 'utf8');
    assert.ok(/href="privacy\.html"/.test(source), `${page} links to the privacy page`);
  }

  const text = doc.body.textContent.replace(/\s+/g, ' ').toLowerCase();
  // The page makes specific promises; the code has to keep them.
  for (const claim of ['no cookies', 'no third-party analytics', 'global privacy control', 'do not track']) {
    assert.ok(text.includes(claim), `privacy page states: ${claim}`);
  }
  assert.ok(text.includes('only'), 'it distinguishes what is and is not recorded');

  // The processor the page names must be the one the relay is wired to, or the
  // policy describes a system that no longer exists.
  const relayReadme = fs.readFileSync('../relay/README.md', 'utf8');
  const processor = /PABBLY_WEBHOOK_URL/.test(relayReadme) ? 'pabbly' : null;
  assert.ok(processor, 'the relay documents a webhook destination');
  assert.ok(text.includes(processor), `privacy page names the processor: ${processor}`);
  // And it must not still be claiming a platform the relay no longer uses.
  assert.ok(!text.includes('hubspot'), 'the privacy page has no stale processor name');

  // The code must actually honour the signals the page promises.
  const tracking = fs.readFileSync('../js/tracking.js', 'utf8');
  assert.ok(/globalPrivacyControl/.test(tracking), 'GPC is read by the tracker');
  assert.ok(/doNotTrack/.test(tracking), 'DNT is read by the tracker');
  assert.ok(!/document\.cookie/.test(tracking), 'the tracker sets no cookie');
});

test('"Open" cursor label is wired to external links that exist', () => {
  const targets = [...document.querySelectorAll('[data-cursor="Open"]')];
  assert.equal(targets.length, 2);
  for (const t of targets) assert.equal(t.getAttribute('target'), '_blank');
});

test('sections: nav and mobile menu follow DOM order, every link resolves, numbers run 01–04 in order', () => {
  const sectionIds = [...document.querySelectorAll('main > section')].map((s) => s.id);
  assert.deepEqual(sectionIds, ['hero', 'projects', 'about', 'journey', 'contact']);
  const hrefs = (sel) => [...document.querySelectorAll(sel)].map((a) => a.getAttribute('href').slice(1));
  const expected = sectionIds.filter((id) => id !== 'hero');
  assert.deepEqual(hrefs('.nav-links a'), expected, 'desktop nav order');
  assert.deepEqual(hrefs('#mobileMenu a'), expected, 'mobile menu order');
  const numbers = [...document.querySelectorAll('.section-number')].map((n) => n.textContent.trim());
  assert.deepEqual(numbers, ['01', '02', '03', '04']);
  // Old deep links keep landing in the right place inside the merged sections.
  assert.equal(document.getElementById('skills').closest('section').id, 'about');
  assert.equal(document.getElementById('experience').closest('section').id, 'journey');
  assert.equal(document.getElementById('education').closest('section').id, 'journey');
  assert.equal(document.getElementById('certifications'), null, 'old #certifications id is gone');
});

test('hero and contact speak to both audiences', () => {
  assert.equal(document.querySelector('.hero-cta').getAttribute('href'), '#contact', 'primary action is to get in touch');
  assert.equal(document.querySelector('.hero-cta-secondary').getAttribute('href'), '#projects');
  assert.match(document.querySelector('.availability').textContent, /freelance projects and full-time roles/);
  const select = document.getElementById('ftopic');
  assert.equal(select.getAttribute('name'), 'topic');
  // The first option is a disabled placeholder so the visitor makes a real choice;
  // the three answers the form can submit are asserted by value, which is what
  // main.js and the email subject actually carry.
  assert.equal(select.options[0].value, '', 'first option is the empty placeholder');
  assert.ok(select.options[0].disabled, 'placeholder cannot be submitted');
  assert.deepEqual(
    [...select.options].filter((o) => o.value !== '').map((o) => o.value),
    ['A job opportunity', 'A freelance project', 'Something else']
  );
  assert.ok(document.querySelector('label[for="ftopic"]'), 'select has a label');
});

test('head script: marks JS on, and a fail-safe readies the hero if main.js never boots', async () => {
  // Only the inline head script runs here (deferred scripts are not loaded), so
  // this is exactly the case the fail-safe exists for.
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/' });
  const classes = dom.window.document.documentElement.classList;
  assert.ok(classes.contains('js'), 'js class set');
  assert.ok(!classes.contains('is-loading'), 'no preloader state');
  assert.ok(!classes.contains('is-ready'), 'not ready until main.js (or the fail-safe) says so');
  const failSafe = /setTimeout\(function \(\) \{ c\.add\('is-ready'\); \}, (\d+)\)/.exec(html);
  assert.ok(failSafe, 'the head script carries a fail-safe');
  assert.ok(Number(failSafe[1]) <= 3000, 'and it fires within 3s');
  dom.window.close();
});
