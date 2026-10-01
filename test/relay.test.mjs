// Tests for the relay's validation boundary. No Workers runtime, no HubSpot
// account, no network: these are the pure functions that decide whether
// anything a browser sends is allowed to reach the CRM, so they are the part
// worth testing hardest. relay/worker.js is a thin shell around them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  ALLOWED_CHANNELS,
  ALLOWED_TOPICS,
  MAX_CLICKS,
  checkBodySize,
  createRateLimiter,
  isAllowedOrigin,
  signBody,
  toPabblyPayload,
  validateEvent,
  validateSubmission,
} from '../relay/lib.js';

const ORIGIN = 'https://arfzkwn-coder.github.io';

const headerRequest = (headers) => new Request('https://relay.test/submit', { method: 'POST', headers });

const validSubmission = (overrides = {}) => Object.assign({
  name: 'Test User',
  email: 'test@example.com',
  topic: 'A job opportunity',
  message: 'Hello, I would like to talk about a role.',
  page: '/portfolio-proj/',
  referrer: 'https://www.linkedin.com/feed/',
  sessionId: 'abc-123',
  utm: { utm_source: 'linkedin', utm_medium: 'social', not_a_utm: 'ignored' },
  clicks: [{ channel: 'linkedin', ts: Date.now() - 1000 }, { channel: 'github', ts: Date.now() - 500 }],
}, overrides);

/* ------------------------------------------------------------------ */
/* Origin allowlist                                                    */
/* ------------------------------------------------------------------ */

test('origin: only the allowlisted site origin passes', () => {
  assert.equal(isAllowedOrigin(headerRequest({ Origin: ORIGIN }), ORIGIN), true);
  assert.equal(isAllowedOrigin(headerRequest({ Origin: `${ORIGIN}/` }), ORIGIN), true, 'trailing slash tolerated');
  assert.equal(isAllowedOrigin(headerRequest({ Referer: `${ORIGIN}/index.html` }), ORIGIN), false,
    'a Referer path is not the bare origin');
  assert.equal(isAllowedOrigin(headerRequest({ Origin: 'https://evil.example' }), ORIGIN), false);
  assert.equal(isAllowedOrigin(headerRequest({ Origin: 'https://arfzkwn-coder.github.io.evil.example' }), ORIGIN), false,
    'a lookalike host is rejected');
  assert.equal(isAllowedOrigin(headerRequest({}), ORIGIN), false, 'a missing Origin fails closed');
  assert.equal(isAllowedOrigin(headerRequest({ Origin: ORIGIN }), ''), false, 'an unset allowlist allows nothing');
  assert.equal(isAllowedOrigin(headerRequest({ Referer: `${ORIGIN}/resume.html` }), ORIGIN), false,
    'Referer is compared as a whole, so a path does not match');
});

/* ------------------------------------------------------------------ */
/* Size + rate limits                                                  */
/* ------------------------------------------------------------------ */

test('body: empty and oversize payloads are refused with the real limit', () => {
  assert.equal(checkBodySize('').ok, false, 'an empty body is not a payload');
  assert.equal(checkBodySize('{}').ok, true);
  const huge = JSON.stringify({ message: 'x'.repeat(9000) });
  const result = checkBodySize(huge);
  assert.equal(result.ok, false);
  assert.equal(result.maxBytes, 8192);
  assert.ok(result.size > result.maxBytes);
});

test('rate limit: the 21st event in a minute is refused, and the window slides', () => {
  let now = 1_000_000;
  const limiter = createRateLimiter({ limit: 20, windowMs: 60_000, now: () => now });
  for (let i = 0; i < 20; i += 1) assert.equal(limiter.check('key').ok, true, `request ${i + 1}`);
  assert.equal(limiter.check('key').ok, false, 'request 21 is refused');
  assert.equal(limiter.check('other').ok, true, 'a different key is unaffected');
  now += 61_000;
  assert.equal(limiter.check('key').ok, true, 'the window slides');
});

/* ------------------------------------------------------------------ */
/* Event validation                                                    */
/* ------------------------------------------------------------------ */

test('event: a well-formed click is accepted and rebuilt from known fields only', () => {
  const result = validateEvent({ channel: 'LinkedIn', page: '/portfolio-proj/', sessionId: 'abc', ts: Date.now(), evil: 'drop me' });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value).sort(), ['channel', 'page', 'sessionId', 'ts']);
  assert.equal(result.value.channel, 'linkedin', 'channel is normalised');
  assert.equal(result.value.evil, undefined, 'unknown keys are dropped, never forwarded');
});

test('event: every malformed shape is refused', () => {
  const base = { channel: 'github', page: '/', sessionId: 'abc', ts: Date.now() };
  const cases = [
    ['unknown channel', { ...base, channel: 'myspace' }],
    ['missing page', { ...base, page: '' }],
    ['missing session', { ...base, sessionId: '' }],
    ['ts in the future', { ...base, ts: Date.now() + 172_800_000 }],
    ['ts before 2020', { ...base, ts: 1_000_000 }],
    ['ts not a number', { ...base, ts: 'yesterday' }],
    ['not an object', ['github']],
    ['null', null],
  ];
  for (const [label, input] of cases) {
    const result = validateEvent(input);
    assert.equal(result.ok, false, `${label} should be refused`);
    assert.ok(result.errors.length > 0, `${label} explains why`);
  }
});

/* ------------------------------------------------------------------ */
/* Submission validation                                               */
/* ------------------------------------------------------------------ */

test('submission: the happy path keeps exactly the documented schema', () => {
  const result = validateSubmission(validSubmission());
  assert.equal(result.ok, true, result.errors && result.errors.join(', '));
  assert.deepEqual(Object.keys(result.value).sort(),
    ['clicks', 'context', 'email', 'message', 'name', 'page', 'referrer', 'sessionId', 'topic', 'utm']);
  assert.equal(result.value.utm.utm_source, 'linkedin');
  assert.equal(result.value.utm.not_a_utm, undefined, 'only utm_ keys survive');
  assert.equal(result.value.clicks.length, 2);
});

test('submission: personal data is validated, not trusted', () => {
  const bad = [
    ['short name', { name: 'A' }],
    ['missing email', { email: '' }],
    ['malformed email', { email: 'not-an-email' }],
    ['email with angle brackets', { email: 'a<b>@example.com' }],
    ['email with a newline', { email: 'a@b.com\nBcc: someone@else.com' }],
    ['empty message', { message: '   ' }],
    ['topic outside the known options', { topic: 'Send me a free quote' }],
  ];
  for (const [label, overrides] of bad) {
    const result = validateSubmission(validSubmission(overrides));
    assert.equal(result.ok, false, `${label} should be refused`);
  }

  // Non-objects go down the early return, so they still report an error rather
  // than throwing somewhere deeper in the handler.
  for (const input of ['name=test', ['a'], null, 42, true, undefined]) {
    const result = validateSubmission(input);
    assert.equal(result.ok, false, `${JSON.stringify(input)} should be refused`);
    assert.ok(result.errors.length > 0);
  }
});

test('submission: markup is stripped rather than forwarded to the CRM', () => {
  const result = validateSubmission(validSubmission({ message: '<script>alert(1)</script>Nice site' }));
  assert.equal(result.ok, true);
  assert.ok(!/[<>]/.test(result.value.message), 'angle brackets never reach the CRM');
  assert.match(result.value.message, /Nice site/);

  const withControl = validateSubmission(validSubmission({ name: 'Test\u0000User' }));
  assert.equal(withControl.value.name.includes('\u0000'), false, 'control characters are removed');
});

test('submission: a topic that is absent is allowed, a topic that is wrong is not', () => {
  assert.equal(validateSubmission(validSubmission({ topic: '' })).ok, true);
  assert.equal(validateSubmission(validSubmission({ topic: 'A freelance project' })).ok, true);
  assert.equal(validateSubmission(validSubmission({ topic: 'A job opportunity ' })).ok, true, 'trimmed before matching');
  for (const topic of ALLOWED_TOPICS) {
    assert.equal(validateSubmission(validSubmission({ topic })).ok, true, `${topic} is a known option`);
  }
});

test('submission: click lists are filtered, bounded, and never inflated', () => {
  const now = Date.now();
  const junk = validateSubmission(validSubmission({
    clicks: [
      { channel: 'linkedin', ts: now },
      { channel: 'unknown', ts: now },
      { channel: 'github', ts: 'nope' },
      null,
      'linkedin',
    ],
  }));
  assert.equal(junk.value.clicks.length, 1, 'only well-formed clicks survive');
  assert.equal(junk.value.clicks[0].channel, 'linkedin');

  const flood = Array.from({ length: 500 }, (_, i) => ({ channel: 'github', ts: now - i }));
  const bounded = validateSubmission(validSubmission({ clicks: flood }));
  assert.equal(bounded.value.clicks.length, MAX_CLICKS, 'a flood cannot bloat the CRM payload');
});

/* ------------------------------------------------------------------ */
/* Signature                                                           */
/* ------------------------------------------------------------------ */

test('signature: a known input produces the expected HMAC, computed independently', async () => {
  const body = '{"event":"form_submission","email":"a@b.com"}';
  const secret = 'test-signing-secret';
  const signature = await signBody(body, secret);

  // Recomputed with Node's crypto, so this fails if the Worker's Web Crypto
  // path and the workflow's verification could ever disagree.
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(signature, expected);
  assert.match(signature, /^[0-9a-f]{64}$/, 'lowercase hex, as the header advertises');
});

test('signature: it changes with the body and with the secret', async () => {
  const secret = 'test-signing-secret';
  const first = await signBody('{"a":1}', secret);
  const second = await signBody('{"a":2}', secret);
  const other = await signBody('{"a":1}', 'a-different-secret');
  assert.notEqual(first, second, 'a tampered body cannot keep its signature');
  assert.notEqual(first, other, 'a different secret produces a different signature');
  assert.equal(first, await signBody('{"a":1}', secret), 'and it is deterministic');
});

test('signature: no secret configured means no signature rather than a weak one', async () => {
  assert.equal(await signBody('{"a":1}', ''), '');
  assert.equal(await signBody('{"a":1}', undefined), '');
});

/* ------------------------------------------------------------------ */
/* Pabbly payload shaping                                              */
/* ------------------------------------------------------------------ */

test('pabbly payload: the click attribution is flattened for the workflow builder', () => {
  const { value } = validateSubmission(validSubmission({
    clicks: [
      { channel: 'linkedin', ts: Date.now() - 3000 },
      { channel: 'linkedin', ts: Date.now() - 2000 },
      { channel: 'github', ts: Date.now() - 1000 },
    ],
  }));
  const payload = toPabblyPayload(value, new Date('2026-10-01T09:30:00Z'));

  assert.equal(payload.event, 'form_submission', 'the event type is in the payload, not only a header');
  assert.equal(payload.submitted_at, '2026-10-01T09:30:00.000Z');
  assert.equal(payload.name, 'Test User');
  assert.equal(payload.email, 'test@example.com');
  assert.equal(payload.topic, 'A job opportunity');
  assert.equal(payload.clicks_total, '3');
  assert.equal(payload.clicks_linkedin, '2');
  assert.equal(payload.clicks_github, '1');
  assert.equal(payload.clicks_coursera, '0');
  assert.equal(payload.last_channel, 'github', 'the last touch, not the first');
  assert.equal(payload.clicked_channels, 'linkedin,github', 'distinct channels, in order');
  assert.equal(payload.utm_source, 'linkedin');
});

test('pabbly payload: it is flat, string-valued, and every key is mapper-safe', () => {
  const { value } = validateSubmission(validSubmission());
  const payload = toPabblyPayload(value);

  for (const [key, entry] of Object.entries(payload)) {
    // A workflow addresses these as {{trigger.<key>}}, so a nested object is
    // unmappable and a mixed type is where a no-code mapper breaks.
    assert.equal(typeof entry, 'string', `${key} is a string`);
    assert.match(key, /^[a-z][a-z0-9_]*$/, `${key} is addressable as {{trigger.${key}}}`);
    assert.equal(Array.isArray(entry), false, `${key} is not an array`);
  }

  // The counting must be self-consistent, or a filter step in the workflow
  // silently disagrees with the total.
  const total = Number(payload.clicks_total);
  const byChannel = ALLOWED_CHANNELS.reduce((sum, channel) => sum + Number(payload[`clicks_${channel}`]), 0);
  assert.equal(total, byChannel, 'clicks_total equals the sum of the per-channel counts');
});

test('pabbly payload: a submission with no clicks still has every field', () => {
  const { value } = validateSubmission(validSubmission({ clicks: [] }));
  const payload = toPabblyPayload(value);

  assert.equal(payload.clicks_total, '0');
  assert.equal(payload.last_channel, '');
  assert.equal(payload.clicked_channels, '');
  assert.equal(payload.first_click_at, '', 'no click means no timestamp, not an invalid date');
  assert.equal(payload.last_click_at, '');
  // Absent browser context must yield empty strings too, never undefined.
  for (const key of ['locale', 'timezone', 'screen', 'viewport']) {
    assert.equal(payload[key], '', `${key} degrades to an empty string`);
  }
});

test('pabbly payload: browser context is passed through when the client sends it', () => {
  const { value } = validateSubmission(validSubmission({
    context: { locale: 'en-GB', timezone: 'Asia/Kuala_Lumpur', screen: '1440x900', viewport: '1280x800' },
  }));
  const payload = toPabblyPayload(value);
  assert.equal(payload.locale, 'en-GB');
  assert.equal(payload.timezone, 'Asia/Kuala_Lumpur');
  assert.equal(payload.screen, '1440x900');
  assert.equal(payload.viewport, '1280x800');
});

test('pabbly payload: a channel outside the allowlist cannot inflate a count', () => {
  const { value } = validateSubmission(validSubmission({
    clicks: [{ channel: 'linkedin', ts: Date.now() }, { channel: 'not-a-real-channel', ts: Date.now() }],
  }));
  const payload = toPabblyPayload(value);
  assert.equal(payload.clicks_total, '1', 'the unknown channel was filtered before counting');
  assert.equal(payload.clicked_channels, 'linkedin');
});

test('channels: the allowlist is closed and matches what the site sends', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const used = [...html.matchAll(/data-track-channel="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(used.length >= 2, 'the site declares tracked channels');
  for (const channel of used) {
    assert.ok(ALLOWED_CHANNELS.includes(channel), `relay and site agree on "${channel}"`);
  }
});
