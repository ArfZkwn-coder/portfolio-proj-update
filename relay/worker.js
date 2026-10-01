/* Portfolio webhook relay — Cloudflare Worker
 *
 * The only component that knows where the automation webhook lives. The site is
 * static and public, so a webhook URL in js/*.js would be scraped; here it lives
 * in the Worker's environment and never leaves the server.
 *
 * Routes
 *   POST /event   — one outbound-link click; acknowledged, not forwarded.
 *                   Click counts are kept in the visitor's browser and travel
 *                   with the submission, so an anonymous click never reaches
 *                   the webhook.
 *   POST /submit  — a contact-form submission plus the clicks that led to it.
 *                   This is the only request that is forwarded.
 *   GET  /health  — a probe that confirms the configuration is present.
 *
 * Everything the client sends is validated by ./lib.js before it goes anywhere.
 *
 * Globals come from the Workers runtime (Response/Request/fetch/crypto/URL and
 * the Web platform classes). No ESLint preset describes that runtime exactly,
 * so `no-undef` is relaxed for this file alone — linting a Workers file with
 * browser or Node globals would be worse than not linting it.
 *
 * Required environment (see relay/README.md):
 *   ALLOWED_ORIGIN         e.g. https://arfzkwn-coder.github.io
 *   PABBLY_WEBHOOK_URL     the Webhook Trigger URL from the workflow
 *   PABBLY_SIGNING_SECRET  any long random string; shared with the workflow
 *
 * Optional:
 *   PABBLY_WAIT_FOR_PROCESSING  "1" to ask Pabbly to hold the response until the
 *                               workflow finishes (see the caveat in the README)
 *   FORWARD_TIMEOUT_MS          defaults to 8000
 */

/* eslint-disable no-undef -- Workers runtime globals; see the note above. */

import {
  checkBodySize,
  createRateLimiter,
  isAllowedOrigin,
  signBody,
  toPabblyPayload,
  validateEvent,
  validateSubmission,
} from './lib.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

// Echo the caller's origin back only when it is the allowlisted one. A
// preflight answer alone is not enough: without this header on the *actual*
// response the browser discards it, and every cross-origin call appears to
// fail with an opaque network error.
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || origin.replace(/\/+$/, '') !== String(env.ALLOWED_ORIGIN || '').replace(/\/+$/, '')) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function reply(request, env, status, body) {
  const headers = Object.assign({}, JSON_HEADERS, corsHeaders(request, env));
  return new Response(status === 204 ? null : JSON.stringify(body || {}), { status, headers });
}

// Cloudflare gives a stable per-request client IP; hashing it keeps raw
// addresses out of the rate-limit map and out of any log we write.
async function clientKey(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const data = new TextEncoder().encode(`${ip}:portfolio-relay`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function readJson(request) {
  const raw = await request.text();
  const size = checkBodySize(raw);
  if (!size.ok) return { ok: false, status: 413, error: `body must be 1..${size.maxBytes} bytes` };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, error: 'body must be JSON' };
  }
}

async function forwardToWebhook(env, payload) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    // Readable in the workflow, so one Webhook Trigger can route by event type.
    'X-Portfolio-Event': payload.event,
  };
  if (env.PABBLY_SIGNING_SECRET) {
    headers['X-Portfolio-Signature'] = `sha256=${await signBody(body, env.PABBLY_SIGNING_SECRET)}`;
  }

  // Pabbly answers as soon as it accepts the request unless the workflow is
  // asked to process first, so a 2xx means "accepted", not "processed".
  let url = env.PABBLY_WEBHOOK_URL;
  if (env.PABBLY_WAIT_FOR_PROCESSING === '1') {
    url += `${url.includes('?') ? '&' : '?'}processed=true`;
  }

  const timeout = Number(env.FORWARD_TIMEOUT_MS) || 8000;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('webhook rejected the submission', response.status, detail.slice(0, 300));
  }
  return response.ok;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      const headers = corsHeaders(request, env);
      // A preflight from an origin that is not allowlisted gets no permission,
      // which is the correct answer.
      return new Response(null, { status: Object.keys(headers).length ? 204 : 403, headers });
    }

    if (url.pathname === '/health') {
      const configured = Boolean(env.ALLOWED_ORIGIN && env.PABBLY_WEBHOOK_URL && env.PABBLY_SIGNING_SECRET);
      // Never echo the webhook URL: it contains the workflow token.
      return reply(request, env, configured ? 200 : 503, {
        ok: configured,
        missing: ['ALLOWED_ORIGIN', 'PABBLY_WEBHOOK_URL', 'PABBLY_SIGNING_SECRET']
          .filter((name) => !env[name]),
      });
    }

    if (request.method !== 'POST') return reply(request, env, 405, { error: 'method not allowed' });
    if (!isAllowedOrigin(request, env.ALLOWED_ORIGIN)) return reply(request, env, 403, { error: 'origin not allowed' });

    const bucket = limiter.check(await clientKey(request));
    if (!bucket.ok) return reply(request, env, 429, { error: 'too many requests' });

    const body = await readJson(request);
    if (!body.ok) return reply(request, env, body.status, { error: body.error });

    // The form's honeypot, checked again server-side: a filled `company` field
    // means a bot, and a bot gets the same 204 a human gets.
    if (body.value && body.value.company) return reply(request, env, 204, {});

    if (url.pathname === '/event') {
      const result = validateEvent(body.value);
      if (!result.ok) return reply(request, env, 400, { error: 'invalid event', details: result.errors });
      // Deliberately not forwarded. Returning 202 keeps the client contract
      // stable if clicks are ever routed somewhere of their own.
      return reply(request, env, 202, { ok: true, forwarded: false });
    }

    if (url.pathname === '/submit') {
      const result = validateSubmission(body.value);
      if (!result.ok) return reply(request, env, 400, { error: 'invalid submission', details: result.errors });
      if (!env.PABBLY_WEBHOOK_URL) {
        console.error('relay is not configured; submission dropped');
        return reply(request, env, 503, { error: 'relay not configured' });
      }
      try {
        const delivered = await forwardToWebhook(env, toPabblyPayload(result.value));
        if (!delivered) return reply(request, env, 502, { error: 'webhook rejected the submission' });
        return reply(request, env, 200, { ok: true });
      } catch (error) {
        console.error('webhook request failed', error && error.message);
        return reply(request, env, 502, { error: 'webhook unreachable' });
      }
    }

    return reply(request, env, 404, { error: 'not found' });
  },
};
