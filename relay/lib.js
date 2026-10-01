/* Control characters are exactly what we intend to strip here, so the
   no-control-regex rule is off for this file on purpose. */
/* eslint-disable no-control-regex */

/* Relay validation — the trust boundary between the public portfolio and the automation.
 *
 * Everything here is pure and dependency-free so it can be unit-tested without
 * a Workers runtime or a Pabbly account (see test/relay.test.mjs). The client
 * is untrusted by definition: it is a static page anyone can open the console
 * on, so nothing it sends is forwarded to the webhook without passing through
 * these functions first.
 *
 * Contract v1 is mirrored in js/tracking.js — change both together.
 */

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_CLICKS = 50;

const TOPICS = ['A job opportunity', 'A freelance project', 'Something else'];
const CHANNELS = ['github', 'linkedin', 'coursera'];

const LIMITS = {
  name: 120,
  email: 200,
  topic: 60,
  message: 4000,
  page: 300,
  referrer: 300,
  sessionId: 64,
  utmKey: 40,
  utmValue: 120,
  channel: 32,
  locale: 35,
  timezone: 64,
  dimension: 20,
};

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Control characters (including newlines) are stripped from single-line fields
// and kept only where a multi-line value is expected. Angle brackets go too:
// the workflow may render some of this, and the relay is not an HTML sanitiser.
function clean(value, max, { allowNewlines = false } = {}) {
  if (value == null) return '';
  let text = String(value);
  text = allowNewlines
    ? text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    : text.replace(/[\u0000-\u001F\u007F]/g, ' ');
  text = text.replace(/[<>]/g, '');
  return text.trim().slice(0, max);
}

// Stripping markup *before* validating would silently rewrite a value: an
// address like `a<b>@example.com` would become the valid `ab@example.com` and
// the stored record would belong to someone else. So structured fields are checked
// as the visitor typed them, and only then cleaned.
const hasMarkup = (value) => /[<>]/.test(String(value == null ? '' : value));

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
const isEmail = (value) => EMAIL.test(String(value || ''));

const isIsoTimestamp = (value) => {
  const ts = Number(value);
  // A plausible epoch-millisecond stamp: after 2020 and not in the future
  // beyond a small clock skew, so a spoofed ts cannot pin itself to year 3000.
  return Number.isFinite(ts) && ts > 1_577_836_800_000 && ts < Date.now() + 86_400_000;
};

/* ------------------------------------------------------------------ */
/* Origin + size gates                                                 */
/* ------------------------------------------------------------------ */

export function isAllowedOrigin(request, allowedOrigin) {
  if (!allowedOrigin) return false;
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');
  const candidates = [origin, referer].filter(Boolean);
  // Neither header present means a non-browser caller: refuse, because an
  // allowlist that fails open is not an allowlist.
  if (candidates.length === 0) return false;
  return candidates.some((value) => String(value).replace(/\/+$/, '') === allowedOrigin.replace(/\/+$/, ''));
}

export function checkBodySize(rawBody, maxBytes = MAX_BODY_BYTES) {
  const size = typeof rawBody === 'string' ? rawBody.length : Number(rawBody) || 0;
  return { ok: size > 0 && size <= maxBytes, size, maxBytes };
}

/* ------------------------------------------------------------------ */
/* Payload validation                                                  */
/* ------------------------------------------------------------------ */

export function validateEvent(input) {
  const errors = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['body must be a JSON object'] };

  const channel = clean(input.channel, LIMITS.channel).toLowerCase();
  if (!CHANNELS.includes(channel)) errors.push(`channel must be one of: ${CHANNELS.join(', ')}`);

  const page = clean(input.page, LIMITS.page);
  if (!page) errors.push('page is required');

  const sessionId = clean(input.sessionId, LIMITS.sessionId);
  if (!sessionId) errors.push('sessionId is required');

  const ts = Number(input.ts);
  if (!isIsoTimestamp(ts)) errors.push('ts must be an epoch-millisecond timestamp');

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { channel, page, sessionId, ts } };
}

// The only payload that carries personal data. It is validated field by field
// and rebuilt from scratch: unknown keys sent by the client are dropped rather
// than forwarded, so the webhook only ever sees this schema.
export function validateSubmission(input) {
  const errors = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['body must be a JSON object'] };
  if (Array.isArray(input)) return { ok: false, errors: ['body must be a JSON object, not an array'] };

  // Checked against the raw input, before any cleaning can rewrite it.
  if (hasMarkup(input.email)) errors.push('email must not contain markup');

  const name = clean(input.name, LIMITS.name);
  if (name.length < 2) errors.push('name is too short');

  const email = clean(input.email, LIMITS.email).toLowerCase();
  if (!isEmail(email)) errors.push('email is not a valid address');

  const message = clean(input.message, LIMITS.message, { allowNewlines: true });
  if (message.length < 2) errors.push('message is too short');

  // The topic is optional (the form ships a placeholder), but a value that is
  // present must be one we recognise, so a spoofed string cannot reach the
  // workflow and land in whatever it stores.
  const topic = clean(input.topic, LIMITS.topic);
  if (topic && !TOPICS.includes(topic)) errors.push('topic is not a recognised option');

  const page = clean(input.page, LIMITS.page);
  const referrer = clean(input.referrer, LIMITS.referrer);
  const sessionId = clean(input.sessionId, LIMITS.sessionId);

  const utm = {};
  if (isPlainObject(input.utm)) {
    for (const [key, value] of Object.entries(input.utm)) {
      if (!/^utm_[a-z]{3,10}$/.test(key)) continue;
      const cleaned = clean(value, LIMITS.utmValue);
      if (cleaned) utm[key.slice(0, LIMITS.utmKey)] = cleaned;
    }
  }

  const clicks = [];
  if (Array.isArray(input.clicks)) {
    for (const entry of input.clicks.slice(-MAX_CLICKS)) {
      const channel = clean(entry && entry.channel, LIMITS.channel).toLowerCase();
      if (!CHANNELS.includes(channel)) continue;
      if (!isIsoTimestamp(entry && entry.ts)) continue;
      clicks.push({ channel, ts: Number(entry.ts) });
    }
  }

  // Optional browser context. Absent is normal (a browser that exposes nothing,
  // or an older client); the payload builder turns a missing value into ''.
  const context = {};
  if (isPlainObject(input.context)) {
    context.locale = clean(input.context.locale, LIMITS.locale);
    context.timezone = clean(input.context.timezone, LIMITS.timezone);
    context.screen = clean(input.context.screen, LIMITS.dimension);
    context.viewport = clean(input.context.viewport, LIMITS.dimension);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, email, topic, message, page, referrer, sessionId, utm, clicks, context } };
}

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

// Best effort only: Workers instances are not shared, so this blunts a single
// runaway client rather than providing a real quota. Documented, not hidden.
export function createRateLimiter({ limit = 20, windowMs = 60_000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return {
    check(key) {
      const stamp = now();
      const bucket = (hits.get(key) || []).filter((ts) => stamp - ts < windowMs);
      if (bucket.length >= limit) {
        hits.set(key, bucket);
        return { ok: false, remaining: 0 };
      }
      bucket.push(stamp);
      hits.set(key, bucket);
      if (hits.size > 5000) hits.clear(); // never grow without bound
      return { ok: true, remaining: limit - bucket.length };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Signature                                                           */
/* ------------------------------------------------------------------ */

// HMAC-SHA256 over the exact bytes being sent, hex encoded. The webhook URL is
// the only credential and is unguessable, but it is also the whole secret, so
// this header is what lets the workflow reject a request that did not come from
// here. Uses Web Crypto, which both the Workers runtime and Node expose.
export async function signBody(body, secret) {
  if (!secret) return '';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/* ------------------------------------------------------------------ */
/* Payload shaping for Pabbly Connect                                  */
/* ------------------------------------------------------------------ */

/* One flat JSON object, POSTed straight to a Pabbly Connect webhook.
 *
 * Flat on purpose: Pabbly exposes the trigger body to the workflow builder as
 * {{trigger.<field>}}, so every nested object is extra clicks for whoever wires
 * the automation up. Names are short for the same reason.
 *
 * CONTRACT v1 — frozen. Adding a field is safe. Renaming or removing one breaks
 * any workflow that already maps it, so change this and relay/README.md
 * together. Every value is a string (a no-code mapper handles those predictably;
 * mixed types are where they break), and every key matches /^[a-z][a-z0-9_]*$/
 * so it stays addressable as {{trigger.key}}.
 */
export function toPabblyPayload(submission, now = new Date()) {
  const count = (channel) => submission.clicks.filter((click) => click.channel === channel).length;
  const channels = [...new Set(submission.clicks.map((click) => click.channel))];
  const last = submission.clicks.length ? submission.clicks[submission.clicks.length - 1] : null;
  const first = submission.clicks.length ? submission.clicks[0] : null;
  const context = submission.context || {};

  return {
    event: 'form_submission',
    submitted_at: new Date(now).toISOString(),

    // What the visitor wrote — the only personal data in the request.
    name: submission.name,
    email: submission.email,
    topic: submission.topic,
    message: submission.message,

    // Where the submission came from.
    page: submission.page,
    referrer: submission.referrer,
    session_id: submission.sessionId,

    // Campaign attribution, when the visitor arrived on a tagged URL.
    utm_source: submission.utm.utm_source || '',
    utm_medium: submission.utm.utm_medium || '',
    utm_campaign: submission.utm.utm_campaign || '',
    utm_content: submission.utm.utm_content || '',
    utm_term: submission.utm.utm_term || '',

    // What they looked at first. Enough to segment on without a second step.
    clicks_total: String(submission.clicks.length),
    clicks_github: String(count('github')),
    clicks_linkedin: String(count('linkedin')),
    clicks_coursera: String(count('coursera')),
    clicked_channels: channels.join(','),
    last_channel: last ? last.channel : '',
    first_click_at: first ? new Date(first.ts).toISOString() : '',
    last_click_at: last ? new Date(last.ts).toISOString() : '',

    // Browser facts, for segmenting or routing without extra enrichment steps.
    locale: context.locale || '',
    timezone: context.timezone || '',
    screen: context.screen || '',
    viewport: context.viewport || '',
  };
}

export const ALLOWED_TOPICS = TOPICS;
export const ALLOWED_CHANNELS = CHANNELS;
