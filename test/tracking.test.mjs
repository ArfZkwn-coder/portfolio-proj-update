// Tests for the client-side tracker (js/tracking.js).
//
// The file is a browser script that also exports its pure helpers, so this
// suite runs the decision logic directly: what gets sent, what does not, and
// what happens when storage or the network misbehaves. Nothing here touches the
// network — the whole point of the feature is that it degrades quietly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { toPabblyPayload, validateSubmission } from '../relay/lib.js';

// js/tracking.js is a browser script that also exports its pure helpers so they
// can be tested without a DOM. CommonJS wraps every file with a `module` object,
// which is exactly what the script's `typeof module !== 'undefined'` check
// expects, so the file is evaluated here inside that wrapper rather than
// required (or imported as ESM, where the check would fail).
const source = fs.readFileSync(fileURLToPath(new URL('../js/tracking.js', import.meta.url)), 'utf8');
const sandbox = { module: { exports: {} }, exports: {}, console, URL, URLSearchParams, TextEncoder, Date, JSON, Math };
sandbox.exports = sandbox.module.exports;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'js/tracking.js' });

// Mirrors `module.exports = api` from the script.
const tracking = sandbox.module.exports;
assert.ok(Object.keys(tracking).length > 5, 'js/tracking.js exported its helpers for testing');

const {
  buildClickEvent, buildSubmission, buildWebhookPayload, endpointMode, isConfigured, isHoneypotFilled,
  isLocalHost, pickUtm, pruneQueue, readBrowserContext, shouldTrack, MAX_QUEUE, QUEUE_TTL_MS, CLICK_QUEUE_KEY,
} = tracking;

const ENDPOINT = 'https://relay.example.workers.dev';
const baseConfig = (overrides = {}) => Object.assign({
  endpoint: ENDPOINT,
  hostname: 'arfzkwn-coder.github.io',
  globalPrivacyControl: false,
  doNotTrack: '',
}, overrides);

/* ------------------------------------------------------------------ */
/* Configuration gate                                                  */
/* ------------------------------------------------------------------ */

test('config: an endpoint is only usable when it is a real URL', () => {
  assert.equal(isConfigured(ENDPOINT), true);
  assert.equal(isConfigured('http://localhost:8787'), true, 'a local relay is still a relay');
  assert.equal(isConfigured(''), false, 'empty is the documented "tracking off" state');
  assert.equal(isConfigured('   '), false);
  assert.equal(isConfigured(null), false);
  assert.equal(isConfigured('not a url'), false);
  assert.equal(isConfigured('javascript:alert(1)'), false, 'a javascript: URL is never an endpoint');
});

test('config: local development never talks to the CRM', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]', 'thing.local']) {
    assert.equal(isLocalHost(host), true, `${host} is local`);
  }
  for (const host of ['arfzkwn-coder.github.io', 'example.com', 'notlocalhost.com', '']) {
    assert.equal(isLocalHost(host), false, `${host} is not local`);
  }
  assert.equal(shouldTrack(baseConfig({ hostname: 'localhost' })), false, 'local means no tracking');
});

test('config: tracking needs an endpoint and is off by default', () => {
  assert.equal(shouldTrack(baseConfig()), true);
  assert.equal(shouldTrack(baseConfig({ endpoint: '' })), false, 'unconfigured means off');
  assert.equal(shouldTrack({}), false, 'missing config means off');
  assert.equal(shouldTrack(null), false, 'no config object at all means off');
});

test('privacy: Do Not Track and Global Privacy Control each disable tracking', () => {
  assert.equal(shouldTrack(baseConfig({ doNotTrack: '1' })), false, 'DNT: 1 is honoured');
  assert.equal(shouldTrack(baseConfig({ doNotTrack: '0' })), true, 'DNT: 0 is an explicit yes');
  assert.equal(shouldTrack(baseConfig({ doNotTrack: 'yes' })), true, 'a non-standard DNT value is ignored');
  assert.equal(shouldTrack(baseConfig({ globalPrivacyControl: true })), false, 'GPC is honoured');
  assert.equal(shouldTrack(baseConfig({ globalPrivacyControl: false })), true);
  assert.equal(shouldTrack(baseConfig({ globalPrivacyControl: true, doNotTrack: '0' })), false,
    'GPC wins over an explicit DNT: 0');
});

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

test('clicks: the event carries no personal data', () => {
  const event = buildClickEvent('linkedin', '/portfolio-proj/', 'session-1', 1_700_000_000_000);
  // Compared as data, not as an object identity: the helpers are evaluated in a
  // separate vm realm, so their objects have a different prototype.
  assert.deepEqual(JSON.parse(JSON.stringify(event)), {
    channel: 'linkedin',
    page: '/portfolio-proj/',
    sessionId: 'session-1',
    ts: 1_700_000_000_000,
  });
  assert.equal(event.email, undefined, 'a click is not an identity');
  assert.equal(event.name, undefined);
});

test('clicks: a missing timestamp is filled in rather than sent as NaN', () => {
  const event = buildClickEvent('github', '/', 's', undefined);
  assert.ok(Number.isFinite(event.ts), 'ts is always a number');
  assert.ok(event.ts > 1_600_000_000_000);
});

test('submission: the payload matches the frozen v1 contract', () => {
  const payload = buildSubmission(
    { name: 'Test User', email: 'test@example.com', topic: 'A job opportunity', message: 'Hello' },
    {
      page: '/portfolio-proj/',
      referrer: 'https://www.linkedin.com/feed/',
      sessionId: 'session-1',
      utm: { utm_source: 'linkedin' },
      clicks: [{ channel: 'linkedin', ts: 1 }],
      browser: { locale: 'en-GB', timezone: 'Asia/Kuala_Lumpur', screen: '1440x900', viewport: '1280x800' },
    }
  );
  assert.deepEqual(Object.keys(payload).sort(),
    ['clicks', 'context', 'email', 'message', 'name', 'page', 'referrer', 'sessionId', 'topic', 'utm']);
  assert.equal(payload.name, 'Test User');
  assert.equal(payload.clicks.length, 1);
  assert.equal(payload.context.timezone, 'Asia/Kuala_Lumpur');
});

test('submission: browser context degrades to empty strings, never undefined', () => {
  // Some environments expose no screen, no Intl, or nothing at all. A workflow
  // mapper must still receive every field it expects.
  const noContext = buildSubmission({ name: 'A' }, {});
  assert.equal(Object.keys(noContext.context).length, 0, 'absent context is simply absent');

  const partial = buildSubmission({ name: 'A' }, { browser: { locale: 'en' } });
  assert.equal(partial.context.locale, 'en');
  assert.equal(partial.context.timezone, '', 'a missing field is an empty string');
  assert.equal(partial.context.screen, '');
  assert.equal(partial.context.viewport, '');
});

test('browser context: a hostile or empty window does not break the read', () => {
  assert.equal(Object.keys(readBrowserContext(null)).length, 0);
  // jsdom in this suite has a location and navigator but no screen sizes.
  assert.doesNotThrow(() => readBrowserContext({ navigator: {}, innerWidth: 0, innerHeight: 0 }));
  const sizes = readBrowserContext({ navigator: { language: 'en' }, screen: { width: 100, height: 200 }, innerWidth: 300, innerHeight: 400 });
  assert.equal(sizes.screen, '100x200');
  assert.equal(sizes.viewport, '300x400');
});

test('submission: field lengths are capped so a paste cannot bloat the request', () => {
  const payload = buildSubmission(
    { name: 'n'.repeat(500), email: 'e'.repeat(500) + '@example.com', topic: 't'.repeat(200), message: 'm'.repeat(9000) },
    { page: 'p'.repeat(900), referrer: 'r'.repeat(900), sessionId: 's'.repeat(200) }
  );
  assert.ok(payload.name.length <= 120);
  assert.ok(payload.email.length <= 200);
  assert.ok(payload.message.length <= 4000);
  assert.ok(payload.page.length <= 300);
  assert.ok(payload.sessionId.length <= 64);
});

test('submission: a missing context does not throw', () => {
  const payload = buildSubmission({ name: 'A' }, undefined);
  assert.equal(payload.clicks.length, 0);
  assert.equal(Object.keys(payload.utm).length, 0);
  assert.equal(payload.page, '');
});

test('submission: the click list travels with the submission that follows it', () => {
  const clicks = Array.from({ length: 80 }, (_, i) => ({ channel: 'github', ts: i }));
  const payload = buildSubmission({ name: 'A' }, { clicks });
  assert.equal(payload.clicks.length, MAX_QUEUE, 'never more than the documented cap');
  assert.equal(payload.clicks[payload.clicks.length - 1].ts, 79, 'the most recent clicks are kept');
});

test('utm: only utm_ parameters survive, and empty values are dropped', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(pickUtm('?utm_source=linkedin&utm_medium=social&ref=spam&utm_term='))),
    { utm_source: 'linkedin', utm_medium: 'social' });
  assert.deepEqual(JSON.parse(JSON.stringify(pickUtm(''))), {});
  assert.deepEqual(JSON.parse(JSON.stringify(pickUtm('?nothing=here'))), {});
});

test('utm: a browser without URLSearchParams yields no attribution instead of throwing', () => {
  // The same script evaluated in a context where the parser does not exist.
  const bare = { module: { exports: {} }, console, URL, TextEncoder, Date, JSON, Math };
  vm.createContext(bare);
  vm.runInContext(source, bare, { filename: 'js/tracking.js' });
  assert.equal(typeof bare.URLSearchParams, 'undefined', 'the context really lacks the parser');
  assert.doesNotThrow(() => bare.module.exports.pickUtm('?utm_source=linkedin'));
  assert.equal(Object.keys(bare.module.exports.pickUtm('?utm_source=linkedin')).length, 0);
});

test('honeypot: any value in the company field marks a bot', () => {
  assert.equal(isHoneypotFilled(''), false);
  assert.equal(isHoneypotFilled('   '), false);
  assert.equal(isHoneypotFilled(null), false);
  assert.equal(isHoneypotFilled('Acme Ltd'), true);
});

/* ------------------------------------------------------------------ */
/* Queue behaviour                                                     */
/* ------------------------------------------------------------------ */

test('queue: entries older than the TTL are dropped, and the cap is enforced', () => {
  const now = 1_700_000_000_000;
  const fresh = { channel: 'github', ts: now - 1000 };
  const stale = { channel: 'github', ts: now - QUEUE_TTL_MS - 1 };
  assert.deepEqual(pruneQueue([stale, fresh], now, QUEUE_TTL_MS), [fresh], 'stale entries are pruned');

  const flood = Array.from({ length: 200 }, (_, i) => ({ channel: 'github', ts: now - i }));
  const pruned = pruneQueue(flood, now, QUEUE_TTL_MS);
  assert.equal(pruned.length, MAX_QUEUE);
  assert.equal(pruned[pruned.length - 1].ts, now, 'the newest entry is retained');
  assert.equal(pruned[0].ts, now - (MAX_QUEUE - 1), 'the cap drops the oldest, not the newest');
  for (let i = 1; i < pruned.length; i += 1) {
    assert.ok(pruned[i].ts >= pruned[i - 1].ts, 'the queue leaves in chronological order');
  }

  // Array order is not trusted: a queue written back-to-front still prunes to
  // the newest entries rather than the first ones it happens to see.
  const reversed = [...flood].reverse();
  assert.deepEqual(pruneQueue(reversed, now, QUEUE_TTL_MS).map((entry) => entry.ts),
    pruned.map((entry) => entry.ts));
});

test('queue: malformed storage contents are discarded rather than trusted', () => {
  const now = Date.now();
  const junk = [null, 'nope', 42, {}, { ts: 'yesterday' }, { channel: 'github' }, { channel: 'github', ts: NaN }];
  assert.equal(pruneQueue(junk, now, QUEUE_TTL_MS).length, 0, 'nothing usable survives');
  assert.equal(pruneQueue('not an array', now, QUEUE_TTL_MS).length, 0);
  assert.equal(pruneQueue(undefined, now, QUEUE_TTL_MS).length, 0);
});

/* ------------------------------------------------------------------ */
/* Markup wiring                                                       */
/* ------------------------------------------------------------------ */

test('markup: every outbound link that matters is instrumented', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const resume = fs.readFileSync(new URL('../resume.html', import.meta.url), 'utf8');

  for (const [name, source] of [['index.html', html], ['resume.html', resume]]) {
    const external = [...source.matchAll(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>/g)];
    assert.ok(external.length > 0, `${name} has external links`);
    for (const [tag] of external.map((match) => [match[0], match[1]])) {
      const href = tag.match(/href="([^"]+)"/)[1];
      const isProfile = /github\.com|linkedin\.com/.test(href);
      if (!isProfile) continue;
      assert.ok(/data-track="outbound"/.test(tag), `${name}: ${href} is instrumented`);
      assert.ok(/data-track-channel="[a-z]+"/.test(tag), `${name}: ${href} names its channel`);
    }
  }

  // The endpoint attribute is where the destination is configured. It may hold
  // either an automation webhook (direct) or a relay Worker URL; what matters is
  // that it exists on both pages and is read, never hard-coded in the script.
  assert.ok(/data-track-endpoint="/.test(html), 'index.html configures an endpoint');
  assert.ok(/data-track-endpoint="/.test(resume), 'resume.html configures an endpoint');
  assert.ok(/js\/tracking\.js/.test(html), 'index.html loads the tracker');
  assert.ok(/js\/tracking\.js/.test(resume), 'resume.html loads the tracker');

  // The résumé has no form, so its endpoint lives on the document instead.
  assert.ok(/<html[^>]+data-track-endpoint/.test(resume), 'the résumé configures tracking on <html>');
});

test('endpoint mode: the route is decided by the configured host', () => {
  assert.equal(endpointMode(''), 'off', 'nothing configured means off');
  assert.equal(endpointMode('not a url'), 'off');
  assert.equal(endpointMode('https://connect.pabbly.com/webhook-listener/webhook/abc'), 'direct',
    'the automation webhook is called straight from the page');
  assert.equal(endpointMode('https://connect.pabbly.com/x'), 'direct');
  assert.equal(endpointMode('https://portfolio-relay.someone.workers.dev'), 'relay',
    'anything else is assumed to be our own relay');
  assert.equal(endpointMode('https://relay.example.com'), 'relay');
});

test('direct mode payload: same field names as the relay would send', () => {
  const payload = buildWebhookPayload(
    { name: 'Test User', email: 'test@example.com', topic: 'A job opportunity', message: 'Hello' },
    {
      page: '/portfolio-proj/',
      referrer: 'https://www.linkedin.com/feed/',
      sessionId: 'session-1',
      utm: { utm_source: 'linkedin' },
      clicks: [
        { channel: 'linkedin', ts: 1_700_000_000_000 },
        { channel: 'github', ts: 1_700_000_060_000 },
      ],
      browser: { locale: 'en-GB', timezone: 'Asia/Kuala_Lumpur', screen: '1440x900', viewport: '1280x800' },
    }
  );

  assert.equal(payload.event, 'form_submission', 'the workflow can route on this');
  assert.equal(payload.name, 'Test User');
  assert.equal(payload.email, 'test@example.com');
  assert.equal(payload.clicks_total, '2');
  assert.equal(payload.clicks_linkedin, '1');
  assert.equal(payload.clicks_github, '1');
  assert.equal(payload.clicked_channels, 'linkedin,github');
  assert.equal(payload.last_channel, 'github');
  assert.match(payload.first_click_at, /^\d{4}-\d{2}-\d{2}T/, 'timestamps are ISO, not epoch numbers');
  assert.equal(payload.utm_source, 'linkedin');
  assert.equal(payload.timezone, 'Asia/Kuala_Lumpur');

  // The same invariants the relay contract is held to, because the workflow
  // sees this object whether the data went direct or through the relay.
  for (const [key, value] of Object.entries(payload)) {
    assert.equal(typeof value, 'string', `${key} is a string`);
    assert.match(key, /^[a-z][a-z0-9_]*$/, `${key} is addressable as {{trigger.${key}}}`);
  }
  const total = Number(payload.clicks_total);
  const summed = Number(payload.clicks_github) + Number(payload.clicks_linkedin) + Number(payload.clicks_coursera);
  assert.equal(total, summed, 'the total agrees with the per-channel counts');
});

test('the direct payload and the relay payload carry the same fields, key for key', () => {
  // The field names exist in two files and there is no build step to share them
  // (the client is a classic script, the relay is ESM), so this is what stops
  // the two hand-kept copies from drifting apart.
  const fields = { name: 'Test User', email: 'test@example.com', topic: 'A job opportunity', message: 'Hello there' };
  const context = {
    page: '/portfolio-proj-update/',
    referrer: 'https://www.linkedin.com/feed/',
    sessionId: 'session-1',
    utm: { utm_source: 'linkedin' },
    clicks: [
      { channel: 'linkedin', ts: 1_700_000_000_000 },
      { channel: 'github', ts: 1_700_000_060_000 },
    ],
    browser: { locale: 'en-GB', timezone: 'Asia/Kuala_Lumpur', screen: '1440x900', viewport: '1280x800' },
  };

  // Whatever the visitor's browser would POST to the relay, validated the way
  // the relay validates it, must land on the same schema as the direct route.
  const validated = validateSubmission(buildSubmission(fields, context));
  assert.ok(validated.ok, `the client wire payload must be accepted by the relay: ${validated.errors}`);

  const direct = buildWebhookPayload(fields, context);
  const relayed = toPabblyPayload(validated.value);
  assert.deepEqual(Object.keys(direct).sort(), Object.keys(relayed).sort(),
    'a workflow must not care which route the data took');

  // Same field names, same shapes: every value is a string in both routes.
  for (const [key, value] of Object.entries(relayed)) {
    assert.equal(typeof value, 'string', `relay ${key} is a string`);
    assert.equal(typeof direct[key], 'string', `direct ${key} is a string`);
  }
});

test('direct mode payload: no clicks and no browser context still produce every field', () => {
  const payload = buildWebhookPayload({ name: 'A' }, {});
  assert.equal(payload.clicks_total, '0');
  assert.equal(payload.clicked_channels, '');
  assert.equal(payload.first_click_at, '', 'no click means an empty string, not an invalid date');
  for (const key of ['locale', 'timezone', 'screen', 'viewport']) {
    assert.equal(payload[key], '', `${key} degrades to an empty string`);
  }
});

test('markup: the tracker is loaded deferred, after main.js', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const mainIndex = html.indexOf('src="js/main.js"');
  const trackIndex = html.indexOf('src="js/tracking.js"');
  assert.ok(mainIndex !== -1 && trackIndex !== -1);
  assert.ok(trackIndex > mainIndex, 'tracking loads after the page it reports on');
  assert.ok(/<script defer src="js\/tracking\.js">/.test(html), 'and it does not block rendering');
});

test('hygiene: the client bundle hard-codes no endpoint and holds no credential', () => {
  const source = fs.readFileSync(new URL('../js/tracking.js', import.meta.url), 'utf8');
  // Naming the automation host is required — that is how direct mode is
  // detected — but the script must never carry an actual URL or a secret: the
  // destination comes from markup, so it can be rotated without touching code.
  const secretish = [
    /pat-[a-z0-9-]{10,}/i,
    /Bearer\s+[A-Za-z0-9._-]{20,}/,
    /api[_-]?key\s*[:=]\s*['"][^'"]{12,}/i,
    /token\s*[:=]\s*['"][^'"]{20,}/i,
    /sendwebhookdata/i,
    /webhook-listener/i,
    /https:\/\/connect\./i,
    /https:\/\/[a-z0-9.-]*(workers\.dev|pabbly\.com)/i,
  ];
  for (const pattern of secretish) {
    assert.ok(!pattern.test(source), `tracking.js must not contain ${pattern}`);
  }
  assert.ok(/data-track-endpoint/.test(source), 'the destination is read from markup');
});

test('hygiene: no secret and no worker credential is anywhere in the shipped bundle', () => {
  const files = ['../js/tracking.js', '../js/main.js'];
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const pattern of [/HUBSPOT/i, /PABBLY_SIGNING_SECRET/, /wrangler secret/i]) {
      assert.ok(!pattern.test(source), `${file} must not mention ${pattern}`);
    }
  }
});

test('hygiene: the queue key is namespaced and versioned', () => {
  assert.match(CLICK_QUEUE_KEY, /^portfolio-[a-z]+-v\d+$/, 'so a contract change can bump rather than collide');
});
