import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('../index.html', 'utf8');
const mainSrc = fs.readFileSync('../js/main.js', 'utf8');
const lib = (p) => fs.readFileSync(new URL(`../node_modules/${p}`, import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// jsdom's pretendToBeVisual drives rAF with timers; unclosed windows keep Node alive forever.
const openDoms = [];
after(() => { for (const d of openDoms) d.window.close(); });

function makeEnv({ finePointer = false, reduced = false, desktop = true, webgl = false, libs = false, totem = null, fetchImpl = null, introSeen = false, captureMailto = false } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  openDoms.push(dom);
  const { window } = dom;
  const { document } = window;

  document.documentElement.classList.add('js', 'is-loading'); // what the inline <head> script does

  window.matchMedia = (q) => ({
    media: q,
    matches: q.includes('reduce') ? reduced : q.includes('hover: hover') ? finePointer : q.includes('901') ? desktop : false,
    addEventListener() {}, removeEventListener() {},
  });
  window.__ios = [];
  window.IntersectionObserver = class {
    constructor(cb, opts = {}) { this.cb = cb; this.opts = opts; this.targets = []; window.__ios.push(this); }
    observe(t) { this.targets.push(t); } unobserve() {} disconnect() { this.targets = []; }
  };
  window.ResizeObserver = class { observe() {} disconnect() {} };
  Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve(), load: () => Promise.resolve([]) }, configurable: true });
  window.HTMLCanvasElement.prototype.getContext = () => (webgl ? {} : null);
  window.scrollTo = () => {}; // jsdom doesn't implement it; Lenis/ScrollTrigger call it normally
  window.fetch = fetchImpl ?? (async () => ({ ok: true }));
  const warns = [];
  window.console.warn = (...a) => warns.push(a.map(String).join(' '));

  if (libs) {
    window.eval(lib('gsap/dist/gsap.min.js'));
    window.eval(lib('gsap/dist/ScrollTrigger.min.js'));
    window.eval(lib('lenis/dist/lenis.min.js'));
  }

  if (introSeen) window.sessionStorage.setItem('intro-seen', '1');

  let src = mainSrc;
  if (captureMailto) { // jsdom can't navigate; expose the mailto URL the form would have opened
    src = src.replace('window.location.href = `mailto:', 'window.__mailto = `mailto:');
    assert.ok(src !== mainSrc, 'mailto capture substitution applied');
  }
  if (totem === 'ok') { window.__totemCalls = []; window.__fakeTotem = { createTotem: async () => ({ setActive: (i) => window.__totemCalls.push(['active', i]), setProgress: (p) => window.__totemCalls.push(['progress', p]) }) }; src = src.replace("import('./totem.js')", 'Promise.resolve(window.__fakeTotem)'); }
  if (totem === 'fail') src = src.replace("import('./totem.js')", "Promise.reject(new Error('boom'))");
  assert.ok(totem ? src !== mainSrc : true, 'test harness substitution applied');

  window.eval(src);
  const io = (pred) => window.__ios.find(pred);
  return { window, document, errors, warns, io, root: document.documentElement };
}

test('baseline: no libs, coarse pointer — page boots, no errors, content never hidden', async () => {
  const { document, errors, root } = makeEnv();
  assert.equal(document.getElementById('year').textContent, String(new Date().getFullYear()));

  const h1 = document.querySelector('.hero-name');
  assert.equal(h1.getAttribute('aria-label'), 'Arif Zakwan.');
  const chars = [...h1.querySelectorAll('.char')];
  assert.equal(chars.length, 'Arif'.length + 'Zakwan.'.length);
  assert.deepEqual(chars.map((c) => c.style.getPropertyValue('--i')), chars.map((_, i) => String(i)));
  assert.ok([...h1.querySelectorAll('.word')].every((w) => w.getAttribute('aria-hidden') === 'true'));
  assert.equal(h1.querySelectorAll('br').length, 1, '<br> preserved');
  assert.ok(h1.querySelector('em .char'), 'chars inside <em> keep accent styling');

  assert.equal(root.classList.contains('has-cursor'), false);
  assert.equal(root.classList.contains('has-totem'), false);
  assert.ok(document.querySelector('.marquee').classList.contains('is-driven'));

  assert.equal(root.classList.contains('is-ready'), false, 'intro still running');
  await sleep(1750);
  assert.equal(root.classList.contains('is-ready'), true);
  assert.equal(root.classList.contains('is-loading'), false);
  assert.equal(document.getElementById('preloaderCount').textContent, '100');
  assert.deepEqual(errors, []);
});

test('menu: aria-expanded, inert and scroll-lock class follow state; Escape closes', () => {
  const { window, document, root } = makeEnv();
  const btn = document.getElementById('hamburger'); const menu = document.getElementById('mobileMenu');
  btn.click();
  assert.equal(btn.getAttribute('aria-expanded'), 'true'); assert.equal(menu.inert, false); assert.ok(root.classList.contains('menu-open')); assert.ok(menu.classList.contains('open'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(btn.getAttribute('aria-expanded'), 'false'); assert.equal(menu.inert, true); assert.ok(!root.classList.contains('menu-open'));
  btn.click(); menu.querySelector('a[href="#skills"]').click();
  assert.equal(btn.getAttribute('aria-expanded'), 'false', 'clicking a menu link closes it');
});

test('reveal + active-nav observers do their jobs', async () => {
  const { document, io } = makeEnv();
  const reveal = io((o) => o.opts.threshold === 0.1);
  const first = reveal.targets[0];
  reveal.cb([{ isIntersecting: true, target: first }]);
  await sleep(120);
  assert.ok(first.classList.contains('visible'));
  assert.ok(reveal.targets.length >= 10);

  const navIO = io((o) => o.opts.rootMargin === '-45% 0px -50% 0px');
  navIO.cb([{ isIntersecting: true, target: document.getElementById('skills') }]);
  const active = document.querySelector('.nav-links a.active');
  assert.equal(active.getAttribute('href'), '#skills'); assert.equal(active.getAttribute('aria-current'), 'true');
  navIO.cb([{ isIntersecting: true, target: document.getElementById('projects') }]);
  assert.equal(document.querySelectorAll('.nav-links a.active').length, 1);
});

test('form (no endpoint): mailto hand-off, honest status, nothing typed is lost; honeypot ignored', () => {
  const { window, document, errors } = makeEnv();
  const form = document.getElementById('contactForm'); const status = document.getElementById('formStatus');
  document.getElementById('fname').value = 'Test User'; document.getElementById('femail').value = 't@example.com'; document.getElementById('fmessage').value = 'Hello there';
  document.getElementById('ftopic').value = 'A freelance project'; // the select starts on its placeholder
  form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  return new Promise((r) => setTimeout(r, 20)).then(() => {
    assert.ok(status.classList.contains('show')); assert.match(status.textContent, /Opening your email app/); assert.ok(!status.textContent.includes('sent'));
    assert.equal(document.getElementById('fmessage').value, 'Hello there', 'form not reset');
    assert.ok(errors.some((e) => /navigation/i.test(e)), 'attempted mailto navigation');
    // honeypot
    status.classList.remove('show'); document.getElementById('fcompany').value = 'bot';
    form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
    return new Promise((r) => setTimeout(r, 20)).then(() => assert.ok(!status.classList.contains('show')));
  });
});

test('form (endpoint): success resets + confirms; failure shows an error and re-enables the button', async () => {
  for (const ok of [true, false]) {
    const calls = [];
    const { window, document } = makeEnv({ fetchImpl: async (url, init) => { calls.push([url, init.method]); if (!ok) throw new Error('net'); return { ok: true }; } });
    const form = document.getElementById('contactForm'); const status = document.getElementById('formStatus'); const btn = form.querySelector('.form-submit');
    form.dataset.endpoint = 'https://example.test/f';
    document.getElementById('fname').value = 'A'; document.getElementById('femail').value = 'a@b.co'; document.getElementById('fmessage').value = 'msg';
    document.getElementById('ftopic').value = 'A job opportunity';
    form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
    await sleep(30);
    assert.deepEqual(calls, [['https://example.test/f', 'POST']]);
    assert.equal(btn.disabled, false);
    if (ok) { assert.match(status.textContent, /Message sent/); assert.equal(document.getElementById('fmessage').value, ''); assert.ok(!status.classList.contains('is-error')); }
    else { assert.ok(status.classList.contains('is-error')); assert.match(status.textContent, /arifzakwan2001@gmail\.com/); assert.equal(document.getElementById('fmessage').value, 'msg', 'message kept on failure'); }
  }
});

test('fine pointer: custom cursor on, follows pointer, external links show an "Open" label', () => {
  const { window, document, root } = makeEnv({ finePointer: true });
  assert.ok(root.classList.contains('has-cursor'));
  const dot = document.getElementById('cursor'); const ring = document.getElementById('cursorRing');
  document.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 120, clientY: 80, bubbles: true }));
  assert.equal(dot.style.getPropertyValue('--x'), '120px'); assert.equal(dot.style.getPropertyValue('--y'), '80px');
  const link = document.querySelector('a.contact-link[data-cursor]');
  link.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }));
  assert.equal(document.getElementById('cursorLabel').textContent, 'Open'); assert.ok(ring.classList.contains('has-label')); assert.ok(dot.classList.contains('is-hidden')); assert.ok(!ring.classList.contains('hover'));
  document.querySelector('.hero-name').dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }));
  assert.equal(document.getElementById('cursorLabel').textContent, ''); assert.ok(!ring.classList.contains('has-label'));
  // magnetic
  const cta = document.querySelector('.hero-cta');
  cta.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 50, clientY: 50, bubbles: true }));
  assert.ok(cta.style.getPropertyValue('--mx').endsWith('px'));
  cta.dispatchEvent(new window.MouseEvent('pointerleave'));
  assert.equal(cta.style.getPropertyValue('--mx'), '');
});

test('reduced motion: everything visible immediately, no marquee drive, no totem, intro skipped', async () => {
  const { document, root, io } = makeEnv({ reduced: true, webgl: true });
  assert.ok([...document.querySelectorAll('.reveal')].every((el) => el.classList.contains('visible')));
  assert.ok(!document.querySelector('.marquee').classList.contains('is-driven'));
  await sleep(10);
  assert.ok(root.classList.contains('is-ready'), 'no preloader delay');
  assert.ok(!io((o) => o.opts.rootMargin === '600px 0px'), 'totem loader never armed');
});

test('totem success path: lazy load -> has-totem, active card + counter + progress wired', async () => {
  const { window, document, root, io } = makeEnv({ webgl: true, totem: 'ok' });
  const loader = io((o) => o.opts.rootMargin === '600px 0px');
  assert.ok(loader, 'loader armed on desktop + WebGL');
  assert.ok(!root.classList.contains('has-totem'), 'nothing happens until the section approaches');
  loader.cb([{ isIntersecting: true, target: document.getElementById('skills') }]);
  await sleep(20);
  assert.ok(root.classList.contains('has-totem'));
  assert.equal(document.getElementById('totemTotal').textContent, '/ 06');
  assert.deepEqual(window.__totemCalls[0], ['active', 0]);

  const cardsIO = io((o) => o.opts.rootMargin === '-45% 0px -45% 0px');
  const cards = [...document.querySelectorAll('.skill-card')];
  assert.equal(cardsIO.targets.length, 6);
  cardsIO.cb([{ isIntersecting: true, target: cards[3] }]);
  assert.ok(cards[3].classList.contains('is-active')); assert.equal(cards.filter((c) => c.classList.contains('is-active')).length, 1);
  assert.equal(document.getElementById('totemIndex').textContent, '04');
  assert.deepEqual(window.__totemCalls.at(-1), ['active', 3]);

  window.dispatchEvent(new window.Event('scroll'));
  await sleep(40);
  const progress = window.__totemCalls.filter((c) => c[0] === 'progress').at(-1);
  assert.ok(progress && progress[1] >= 0 && progress[1] <= 1, 'progress within 0..1');
  // loader only fires once
  loader.cb([{ isIntersecting: true, target: document.getElementById('skills') }]);
  assert.equal(window.__totemCalls.filter((c) => c[0] === 'active' && c[1] === 0).length, 1);
});

test('totem failure path: import/WebGL failure falls back to the static grid and warns', async () => {
  const { document, root, io, warns } = makeEnv({ webgl: true, totem: 'fail' });
  io((o) => o.opts.rootMargin === '600px 0px').cb([{ isIntersecting: true, target: document.getElementById('skills') }]);
  await sleep(20);
  assert.ok(!root.classList.contains('has-totem'), 'class removed again');
  assert.ok(warns.some((w) => /3D totem unavailable/.test(w)));
});

test('no WebGL or mobile viewport: totem loader is never armed', () => {
  assert.ok(!makeEnv({ webgl: false }).io((o) => o.opts.rootMargin === '600px 0px'));
  assert.ok(!makeEnv({ webgl: true, desktop: false }).io((o) => o.opts.rootMargin === '600px 0px'));
});

test('with real GSAP + ScrollTrigger + Lenis loaded: boots without errors and wires them', async () => {
  const { window, document, root, errors, warns } = makeEnv({ libs: true, finePointer: true, webgl: false });
  assert.ok(window.gsap && window.ScrollTrigger && window.Lenis);
  assert.ok(root.classList.contains('lenis'), 'Lenis initialised (adds .lenis to <html>)');
  assert.ok(window.ScrollTrigger.getAll().length >= 3, `ScrollTrigger instances created: ${window.ScrollTrigger.getAll().length}`);
  await sleep(1750);
  assert.ok(root.classList.contains('is-ready'));
  // menu open/close drives lenis.stop/start without throwing
  document.getElementById('hamburger').click(); document.getElementById('hamburger').click();
  assert.deepEqual(errors, []); assert.deepEqual(warns, []);
});

test('intro: plays once per session — marked seen after playing, skipped when already seen, never marked under reduced motion', async () => {
  const first = makeEnv();
  assert.equal(first.window.sessionStorage.getItem('intro-seen'), null, 'not seen before the intro plays');
  await sleep(1750);
  assert.ok(first.root.classList.contains('is-ready'));
  assert.equal(first.window.sessionStorage.getItem('intro-seen'), '1', 'intro marks itself as seen');

  const repeat = makeEnv({ introSeen: true });
  await sleep(60); // far below the 1.1s minimum the intro takes on a first visit
  assert.ok(repeat.root.classList.contains('is-ready'), 'repeat visit is ready almost immediately');
  assert.equal(repeat.document.getElementById('preloaderCount').textContent, '000', 'preloader counter never ran');

  const reduced = makeEnv({ reduced: true });
  await sleep(60);
  assert.ok(reduced.root.classList.contains('is-ready'));
  assert.equal(reduced.window.sessionStorage.getItem('intro-seen'), null, 'skipping for reduced motion is not "having seen it"');
});

test('intro: blocked sessionStorage fails soft — intro still completes, no errors', async () => {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  openDoms.push(dom);
  const { window } = dom;
  Object.defineProperty(window, 'sessionStorage', { get() { throw new window.DOMException('blocked', 'SecurityError'); } });
  window.document.documentElement.classList.add('js', 'is-loading');
  window.matchMedia = (q) => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {} });
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.ResizeObserver = class { observe() {} disconnect() {} };
  Object.defineProperty(window.document, 'fonts', { value: { ready: Promise.resolve(), load: () => Promise.resolve([]) }, configurable: true });
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollTo = () => {};
  window.eval(mainSrc);
  await sleep(1750);
  assert.ok(window.document.documentElement.classList.contains('is-ready'), 'page still becomes ready');
  assert.deepEqual(errors, []);
});

test('form: the chosen topic is in the email subject and body, and in the endpoint payload', async () => {
  const mail = makeEnv({ captureMailto: true });
  const fill = (env, topic) => {
    env.document.getElementById('fname').value = 'Test User'; env.document.getElementById('femail').value = 't@example.com';
    env.document.getElementById('fmessage').value = 'Hello there'; env.document.getElementById('ftopic').value = topic;
    env.document.getElementById('contactForm').dispatchEvent(new env.window.Event('submit', { cancelable: true, bubbles: true }));
  };
  fill(mail, 'A freelance project'); await sleep(20);
  const url = new URL(mail.window.__mailto);
  assert.equal(url.protocol, 'mailto:');
  assert.equal(url.searchParams.get('subject'), 'Portfolio enquiry: A freelance project (from Test User)');
  assert.match(url.searchParams.get('body'), /Topic: A freelance project\nFrom: Test User\nEmail: t@example\.com/);

  const sent = [];
  const api = makeEnv({ fetchImpl: async (u, opts) => { sent.push([u, opts.body]); return { ok: true }; } });
  api.document.getElementById('contactForm').dataset.endpoint = 'https://forms.test/f';
  fill(api, 'A job opportunity'); await sleep(20);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].get('topic'), 'A job opportunity');
  assert.equal(sent[0][1].get('name'), 'Test User');
});

test('menu: opening moves focus into the panel, Tab is trapped, Escape restores focus', () => {
  const { window, document } = makeEnv();
  const btn = document.getElementById('hamburger');
  const menu = document.getElementById('mobileMenu');
  const links = [...menu.querySelectorAll('a')];

  btn.click();
  assert.equal(document.activeElement, links[0], 'focus lands on the first menu link');
  assert.equal(btn.getAttribute('aria-label'), 'Close menu', 'the button name follows the state');

  // Focus the last link, then Tab: the trap must wrap to the first instead of
  // escaping into the page behind the modal.
  links.at(-1).focus();
  const tab = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  assert.equal(links.at(-1).dispatchEvent(tab), false, 'Tab from the last link is intercepted');
  assert.equal(document.activeElement, links[0], 'focus wrapped to the first link');

  const shiftTab = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  assert.equal(links[0].dispatchEvent(shiftTab), false, 'Shift+Tab from the first link is intercepted');
  assert.equal(document.activeElement, links.at(-1), 'focus wrapped to the last link');

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(document.activeElement, btn, 'focus returns to the menu button');
  assert.equal(btn.getAttribute('aria-label'), 'Open menu');
});

test('form: inline validation marks fields, focuses the first problem, and clears on input', () => {
  const { window, document, errors } = makeEnv();
  const form = document.getElementById('contactForm');
  const submit = () => form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

  submit();
  const name = document.getElementById('fname');
  const nameError = document.getElementById('fname-error');
  assert.equal(name.getAttribute('aria-invalid'), 'true', 'empty name is marked invalid');
  assert.equal(nameError.hidden, false, 'the message is revealed');
  assert.match(nameError.textContent, /enter your name/i);
  assert.equal(document.getElementById('fmessage').getAttribute('aria-invalid'), 'true', 'every empty field reports');
  assert.match(document.getElementById('formStatus').textContent, /highlighted fields/i);
  assert.ok(document.getElementById('formStatus').classList.contains('is-error'));
  assert.deepEqual(errors.filter((e) => /navigation/i.test(e)), [], 'nothing was submitted or navigated');

  // Typing a value clears the state again.
  name.value = 'Test User';
  name.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(nameError.hidden, true, 'error clears once the field is valid');
  assert.equal(name.getAttribute('aria-invalid'), null);
});

test('form: a bad email is reported by the inline copy, not a native bubble', () => {
  const { window, document } = makeEnv();
  const email = document.getElementById('femail');
  email.value = 'not-an-email';
  email.dispatchEvent(new window.Event('blur'));
  const error = document.getElementById('femail-error');
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /incomplete|valid/i);
  assert.equal(document.getElementById('contactForm').hasAttribute('novalidate'), true, 'native bubbles are off');
});

test('form: the submit button reports a busy state while the endpoint is pending', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { window, document } = makeEnv({ fetchImpl: () => pending });

  const form = document.getElementById('contactForm');
  form.dataset.endpoint = 'https://forms.test/f';
  document.getElementById('fname').value = 'Test User';
  document.getElementById('femail').value = 't@example.com';
  document.getElementById('fmessage').value = 'Hello';
  document.getElementById('ftopic').value = 'A job opportunity';

  const button = form.querySelector('.form-submit');
  form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await sleep(10);

  assert.equal(form.getAttribute('aria-busy'), 'true', 'the form announces it is busy');
  assert.equal(button.disabled, true, 'the button cannot be double-submitted');
  assert.equal(button.getAttribute('aria-busy'), 'true');

  release({ ok: true });
  await sleep(20);
  assert.equal(form.getAttribute('aria-busy'), 'false');
  assert.equal(button.disabled, false, 'the button is usable again');
  assert.match(document.getElementById('formStatus').textContent, /Message sent/);
});

test('certifications: the verify link is reachable without a hover', () => {
  const { document } = makeEnv();
  const verify = document.querySelector('.cert-verify');
  assert.ok(verify, 'verify link present');
  assert.ok(!verify.hasAttribute('hidden'), 'not hidden from assistive tech');
  assert.ok(!verify.hasAttribute('tabindex') || verify.getAttribute('tabindex') !== '-1', 'in the tab order');
  assert.ok(verify.getAttribute('aria-label'), 'the bare "Verify" text has a descriptive name');
});
