# Webhook relay (optional)

The relay keeps the automation webhook URL **server-side**. The site currently
runs without it — the Pabbly webhook URL sits in `data-track-endpoint` in the
markup, which is simpler but makes that URL public. Deploy this when you want the
URL hidden and every payload validated before it reaches the workflow.

```
browser                          relay (this Worker)               automation
──────────────────────────────   ─────────────────────────────   ───────────────────
click on a tracked link  ──┐
  → POST /event             ├─→  validate origin, size, shape
  → POST /submit            │    strip markup, honeypot, rate limit
  (carries the click list) ─┘    → POST /submit only ──────────→  Pabbly Connect
                                                                  Webhook Trigger
                                                                  {{trigger.*}}
```

Swap modes by changing one attribute — `js/tracking.js` picks the route from the
endpoint's host (`pabbly.com` → direct, anything else → relay), so there is
nothing else to configure. The field names are identical either way.

Anonymous clicks never leave the visitor's browser: the counts are queued
locally and only travel inside a submission the visitor chose to send. That is
both a privacy decision and the reason the automation never sees a stranger.

## Files

| File | Purpose |
| --- | --- |
| `worker.js` | the Worker: routing, CORS, rate limiting, one forward |
| `lib.js` | pure validation and payload shaping — unit-tested, no runtime needed |

`lib.js` is exercised by `test/relay.test.mjs`, which runs with plain `node` and
needs neither a Workers runtime nor a Pabbly account.

## Deploy

Requires a Cloudflare account and the [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) CLI.

```bash
cd relay
npx wrangler secret put ALLOWED_ORIGIN
npx wrangler secret put PABBLY_WEBHOOK_URL
npx wrangler secret put PABBLY_SIGNING_SECRET
npx wrangler deploy
```

A minimal `wrangler.toml`:

```toml
name = "portfolio-webhook-relay"
main = "worker.js"
compatibility_date = "2026-01-01"
```

Generate the signing secret with any long random value, for example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Environment

| Variable | Notes |
| --- | --- |
| `ALLOWED_ORIGIN` | `https://arfzkwn-coder.github.io` — scheme and host only, **no trailing slash**, no path. Everything else gets `403`. |
| `PABBLY_WEBHOOK_URL` | the Webhook Trigger URL from the workflow. This is the only credential, so it stays here and never in the markup. |
| `PABBLY_SIGNING_SECRET` | any long random string. Sent as an HMAC signature so a leaked URL alone cannot write to the automation. |
| `PABBLY_WAIT_FOR_PROCESSING` | optional; `1` asks Pabbly to wait for the workflow. See the caveat below. |
| `FORWARD_TIMEOUT_MS` | optional; defaults to `8000`. |

### Verify it is alive

```bash
curl -i https://<worker>.workers.dev/health
# 200 {"ok":true,"missing":[]}        → configured
# 503 {"ok":false,"missing":[...]}   → those variables are unset
```

`/health` deliberately never echoes the webhook URL — it contains the token.

## Wire contract

Everything is versioned as **v1** and frozen. Adding a field is safe; renaming
one breaks any workflow that already maps it, so change `lib.js`, the tests and
this table together.

### `POST /submit` → the forwarded body

Flat, one level, every value a string, every key addressable in Pabbly as
`{{trigger.<key>}}`:

| Field | Example | Notes |
| --- | --- | --- |
| `event` | `form_submission` | also sent as the `X-Portfolio-Event` header |
| `submitted_at` | `2026-10-01T09:30:00.000Z` | ISO 8601 |
| `name` | `Arif` | |
| `email` | `a@b.com` | |
| `topic` | `A job opportunity` | one of three fixed values, or empty |
| `message` | `Hello…` | newlines preserved |
| `page` | `/portfolio-proj/` | the page they submitted from |
| `referrer` | `https://…` | empty when the browser sends none |
| `session_id` | `uuid` | random per tab; not an identity |
| `utm_source` … `utm_term` | `linkedin` | all five UTM parameters, empty when absent |
| `clicks_total` | `3` | `0` when they clicked nothing |
| `clicks_github` | `1` | one count per tracked channel |
| `clicks_linkedin` | `2` | |
| `clicks_coursera` | `0` | |
| `clicked_channels` | `linkedin,github` | distinct channels in click order, for one-step filtering |
| `last_channel` | `github` | the most recent outbound click |
| `first_click_at` / `last_click_at` | ISO 8601 | empty when there were no clicks |
| `locale` | `en-GB` | browser language |
| `timezone` | `Asia/Kuala_Lumpur` | |
| `screen` / `viewport` | `1440x900` | empty when the browser hides them |

Invariants a workflow can rely on: `clicks_total` equals the sum of the
per-channel counts, every newline-free value is trimmed and length-capped, and
no field is ever `null` or `undefined` — absent means an empty string.

### `POST /event` → acknowledged, not forwarded

```json
{ "channel": "linkedin", "page": "/portfolio-proj/", "sessionId": "…", "ts": 1790000000000 }
```

Answered `202 {"ok":true,"forwarded":false}`. Click counts live in the visitor's
browser and arrive with the submission, so the webhook is never called for an
anonymous visitor. The route exists so that contract stays stable if clicks are
ever routed somewhere of their own.

### Responses

`200` forwarded (see the caveat) · `202` event counted · `204` honeypot, silently
dropped · `400` validation failed (`details` explains) · `403` origin not allowed
· `405` wrong method · `413` body over 8 KB · `429` rate limited · `502` webhook
refused or unreachable · `503` unconfigured.

## The 200 caveat (read this)

Pabbly's Webhook Trigger **returns 200 as soon as it accepts the request**,
before the workflow runs ([forum](https://forum.pabbly.com/threads/webhook-trigger-can-it-return-custom-data-after-workflow-finishes.30983)).
So:

- a `200` to the visitor means *"your message was accepted"*, not *"the
  automation succeeded"*;
- the page shows "Message sent" on acceptance, and a later failure inside the
  workflow is visible only in Pabbly's **Task History**, not to the visitor;
- check Task History when testing, and turn on Pabbly's retry setting for the
  paths that matter.

If you would rather the visitor saw a real failure, set
`PABBLY_WAIT_FOR_PROCESSING=1`. That makes the relay hold the response until the
workflow finishes, which couples the visitor's wait — and any workflow timeout —
to the page. The exact query parameter Pabbly expects for this is applied as
`?processed=true`; verify it against your workflow, because that is a claim I
could not confirm from their documentation.

## Signature

Every forwarded request carries:

```
X-Portfolio-Event: form_submission
X-Portfolio-Signature: sha256=<hex hmac of the raw body, key = PABBLY_SIGNING_SECRET>
```

To act on it, add a step at the top of the workflow that recomputes the HMAC
over the raw body and stops the workflow when it does not match. Without that
step the signature is informational — the URL alone still accepts writes
([Pabbly's guidance](https://www.pabbly.com/integrating-api-with-pabbly-connect-a-step-by-step-guide/)
on reading incoming request data covers the trigger side).

Replay protection is **not** implemented: the signature proves origin and
integrity, not freshness. For a contact form that trade-off is deliberate —
a replayed enquiry is noise, not a breach. Add a timestamp/nonce check in the
workflow if that changes.

## Wiring up the automation

1. In Pabbly Connect, create a workflow with a **Webhook Trigger** and copy its
   URL into `PABBLY_WEBHOOK_URL`.
2. Send one real submission from the deployed site (put the Worker URL in
   `data-track-endpoint` first — see below) so the trigger captures the field
   structure. You can also use Pabbly's built-in test request, but the real one
   is easier to trust because the field names come from the actual payload.
3. Build the steps you want from `{{trigger.*}}`: store the contact, notify
   yourself, add a row to a sheet, tag by `clicked_channels`, whatever the
   workflow is for.
4. Confirm the submission appears in **Task History**.

## Pointing the site at it

Put the Worker URL in the markup — **not** in JavaScript:

- `index.html` → `<form id="contactForm" data-track-endpoint="https://…">`
- `resume.html` → `<html lang="en" data-track-endpoint="https://…">` (no form on that page)

Both ship empty on purpose, and empty means **tracking is off**: the form falls
back to `mailto:`, click counting does nothing, and no test needs changing. To
turn tracking off again, empty those two attributes.

`test/tracking.test.mjs` asserts the client bundle contains no credential, no
webhook URL and no vendor name, so a shortcut here fails the suite rather than
shipping.

## Privacy

`privacy.html` states what is collected; `js/tracking.js` has to keep those
promises, and `test/site.integrity.test.mjs` checks that the page names the
platform the relay actually uses:

- no cookies (`document.cookie` never appears in the tracker);
- `Global Privacy Control` and `Do Not Track: 1` each disable everything;
- no raw IP is stored client-side — the Worker hashes it purely to rate limit;
- the only identifier is random per tab and does not survive the session.

## Operational notes

- **Rate limiting is best effort.** Workers instances are not shared, so
  `createRateLimiter` blunts a runaway client rather than enforcing a quota. Add
  Workers KV or Durable Objects if that stops being enough.
- **Body size** is capped at 8 KB before parsing; validation then rebuilds the
  payload from known fields, so unknown keys a client invents are dropped rather
  than forwarded.
- **Markup is rejected, not escaped.** The relay is not an HTML sanitiser — it
  strips angle brackets from free text and refuses an email address containing
  them, because silently rewriting an address would route a reply to the wrong
  person. Whatever the workflow does with the text, it should not trust it as
  HTML either.
