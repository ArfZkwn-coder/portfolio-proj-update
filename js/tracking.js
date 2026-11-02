/* Portfolio tracking — Arif Zakwan
 *
 * Sends two kinds of event to the relay (see relay/worker.js), which is the
 * only component that talks to the automation webhook:
 *
 *   1. an outbound-link click on a [data-track] link (LinkedIn, GitHub, …)
 *   2. a completed contact-form submission, carrying the clicks that led up to it
 *
 * Design rules, in priority order:
 *
 *   - The page works exactly as before without any of this. If the endpoint is
 *     unset, the host is local, or a privacy signal is set, nothing is sent and
 *     the form still falls back to mailto.
 *   - Nothing secret lives here. A static, public bundle cannot hold the
 *     webhook URL; the relay holds it.
 *   - No cookie, no third-party script, no cross-site identifier. The only
 *     identifier is a random per-tab value in sessionStorage.
 *   - A click event must never delay a navigation, so it goes out with
 *     sendBeacon (falling back to a keepalive fetch) and is never awaited.
 *
 * The pure parts are exported for tests; the browser-only parts run last.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Contract with the relay — keep in sync with relay/lib.js            */
  /* ------------------------------------------------------------------ */

  const CLICK_QUEUE_KEY = 'portfolio-clicks-v1';
  const SESSION_KEY = 'portfolio-session-v1';

  // Capped so a bored visitor cannot fill storage, and pruned so a stale queue
  // does not attribute a submission made days later.
  const MAX_QUEUE = 50;
  const QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  /* ------------------------------------------------------------------ */
  /* Pure helpers — safe to run in Node                                  */
  /* ------------------------------------------------------------------ */

  const str = (value, max) => String(value == null ? '' : value).trim().slice(0, max || 500);

  // The markup ships with this label in the relay URL until the Worker is
  // deployed (see relay/README.md). It names no real host, so it must count as
  // "off": otherwise every submission goes to a host that does not resolve and
  // the form reports failure instead of falling back to mailto.
  const PLACEHOLDER_LABEL = 'your-subdomain';

  // A tracking endpoint is only usable when it is configured and is a real
  // network origin. `new URL()` alone is not enough: it happily parses
  // `javascript:alert(1)`, and an empty string is the documented "off" state.
  function isConfigured(endpoint) {
    const value = str(endpoint, 2048);
    if (!value) return false;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
      return !url.hostname.toLowerCase().split('.').includes(PLACEHOLDER_LABEL);
    } catch {
      return false;
    }
  }

  // Local development and any non-configured deploy must stay silent, so a
  // preview or a fork can never write into the real workflow.
  function isLocalHost(hostname) {
    const host = str(hostname, 255).toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local');
  }

  function shouldTrack(config) {
    const options = config || {};
    if (!isConfigured(options.endpoint)) return false;
    // Local hosts are exempt, because a real local server must not write into
    // the live workflow. There is one opt-in escape hatch, documented for tests
    // only: `allowLocal` derives from a flag the test harness sets on the
    // window, never from markup, so a page cannot turn it on for itself.
    if (options.allowLocal !== true && isLocalHost(options.hostname)) return false;
    // Both signals mean "do not track me"; honour either, permanently.
    if (options.globalPrivacyControl === true) return false;
    if (str(options.doNotTrack, 10) === '1') return false;
    return true;
  }

  /* How the endpoint is reached.
   *
   *   'relay'  — our own Worker (see relay/). It holds the real webhook URL as
   *              a secret, validates everything, and signs what it forwards.
   *   'direct' — the automation webhook itself, called straight from the page.
   *              Simpler, no infrastructure to deploy, but the URL is public
   *              and there is no origin check, rate limit or validation in
   *              front of the workflow.
   *
   * Detected from the endpoint host rather than a second attribute, so there is
   * one thing to configure per page and nothing to keep in sync.
   */
  function endpointMode(endpoint) {
    if (!isConfigured(endpoint)) return 'off';
    try {
      const host = new URL(str(endpoint, 2048)).hostname.toLowerCase();
      if (host.endsWith('pabbly.com')) return 'direct';
      return 'relay';
    } catch {
      return 'relay';
    }
  }

  // Turns the collected pieces into the flat, mapper-ready object the
  // automation receives. Mirrors toPabblyPayload() in relay/lib.js, so the
  // workflow sees the same field names whichever route the data takes.
  function buildWebhookPayload(fields, context) {
    const values = fields || {};
    const ctx = context || {};
    const clicks = Array.isArray(ctx.clicks) ? ctx.clicks : [];
    const browser = ctx.browser && typeof ctx.browser === 'object' ? ctx.browser : {};
    const utm = ctx.utm && typeof ctx.utm === 'object' ? ctx.utm : {};

    const channelCount = (channel) => clicks.filter((click) => click.channel === channel).length;
    const channels = [];
    clicks.forEach((click) => {
      if (click.channel && channels.indexOf(click.channel) === -1) channels.push(click.channel);
    });
    const first = clicks.length ? clicks[0] : null;
    const last = clicks.length ? clicks[clicks.length - 1] : null;
    const iso = (ts) => (Number.isFinite(Number(ts)) ? new Date(Number(ts)).toISOString() : '');

    return {
      event: 'form_submission',
      submitted_at: new Date().toISOString(),
      name: str(values.name, 120),
      email: str(values.email, 200),
      topic: str(values.topic, 60),
      message: str(values.message, 4000),
      page: str(ctx.page, 300),
      referrer: str(ctx.referrer, 300),
      session_id: str(ctx.sessionId, 64),
      utm_source: str(utm.utm_source, 120),
      utm_medium: str(utm.utm_medium, 120),
      utm_campaign: str(utm.utm_campaign, 120),
      utm_content: str(utm.utm_content, 120),
      utm_term: str(utm.utm_term, 120),
      clicks_total: String(clicks.length),
      clicks_github: String(channelCount('github')),
      clicks_linkedin: String(channelCount('linkedin')),
      clicks_coursera: String(channelCount('coursera')),
      clicked_channels: channels.join(','),
      last_channel: last ? str(last.channel, 32) : '',
      first_click_at: first ? iso(first.ts) : '',
      last_click_at: last ? iso(last.ts) : '',
      locale: str(browser.locale, 35),
      timezone: str(browser.timezone, 64),
      screen: str(browser.screen, 20),
      viewport: str(browser.viewport, 20),
    };
  }

  // only the five UTM parameters, only when present, never empty strings.
  function pickUtm(search) {
    const source = str(search, 2048);
    if (!source) return {};
    // Resolved defensively: on a browser without URLSearchParams we would
    // rather return no attribution than throw on the way to the relay.
    if (typeof URLSearchParams !== 'function') return {};
    let params;
    try {
      params = new URLSearchParams(source);
    } catch {
      return {};
    }
    const out = {};
    UTM_KEYS.forEach((key) => {
      const value = str(params.get(key), 120);
      if (value) out[key] = value;
    });
    return out;
  }

  function buildClickEvent(channel, page, sessionId, ts) {
    return {
      channel: str(channel, 32),
      page: str(page, 300),
      sessionId: str(sessionId, 64),
      ts: Number.isFinite(ts) ? ts : Date.now(),
    };
  }

  // The submission is the *only* payload that carries personal data, and it is
  // sent only when the visitor chose to press Send.
  function buildSubmission(fields, context) {
    const values = fields || {};
    const ctx = context || {};
    return {
      name: str(values.name, 120),
      email: str(values.email, 200),
      topic: str(values.topic, 60),
      message: str(values.message, 4000),
      page: str(ctx.page, 300),
      referrer: str(ctx.referrer, 300),
      sessionId: str(ctx.sessionId, 64),
      utm: ctx.utm && typeof ctx.utm === 'object' ? ctx.utm : {},
      clicks: Array.isArray(ctx.clicks) ? ctx.clicks.slice(-MAX_QUEUE) : [],
      context: ctx.browser && typeof ctx.browser === 'object' ? {
        locale: str(ctx.browser.locale, 35),
        timezone: str(ctx.browser.timezone, 64),
        screen: str(ctx.browser.screen, 20),
        viewport: str(ctx.browser.viewport, 20),
      } : {},
    };
  }

  // Facts about the browser that help whoever reads the submission segment or
  // route it, without a separate enrichment step. Every one of them is optional
  // and degrades to an empty string, so a mapper never sees undefined.
  function readBrowserContext(window) {
    if (!window) return {};
    const dimension = (width, height) => (Number(width) && Number(height) ? `${width}x${height}` : '');
    let timezone;
    try {
      timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      timezone = ''; // an unusual environment must not break the submission
    }
    return {
      locale: window.navigator.language || '',
      timezone,
      screen: dimension(window.screen && window.screen.width, window.screen && window.screen.height),
      viewport: dimension(window.innerWidth, window.innerHeight),
    };
  }

  // Keeps the newest events, drops anything past its TTL, and tolerates any
  // shape of junk that storage might hand back. Sorting by timestamp (rather
  // than trusting array order) is what makes "newest" mean newest: a queue
  // written by an older version, or merged across tabs, need not be ordered.
  function pruneQueue(queue, now, ttl) {
    const cutoff = (Number.isFinite(now) ? now : Date.now()) - (ttl || QUEUE_TTL_MS);
    return (Array.isArray(queue) ? queue : [])
      .filter((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const ts = Number(entry.ts);
        return Number.isFinite(ts) && ts >= cutoff;
      })
      .sort((a, b) => Number(a.ts) - Number(b.ts))
      .slice(-MAX_QUEUE);
  }

  function isHoneypotFilled(value) {
    return str(value, 200).length > 0;
  }

  /* ------------------------------------------------------------------ */
  /* Browser runtime                                                     */
  /* ------------------------------------------------------------------ */

  function createRuntime(window, document) {
    const storage = (area) => {
      try {
        return window[area];
      } catch {
        return null; // storage blocked: every call below fails soft
      }
    };

    const readQueue = () => {
      const store = storage('localStorage');
      if (!store) return [];
      try {
        return pruneQueue(JSON.parse(store.getItem(CLICK_QUEUE_KEY) || '[]'), Date.now(), QUEUE_TTL_MS);
      } catch {
        return [];
      }
    };

    const writeQueue = (queue) => {
      const store = storage('localStorage');
      if (!store) return;
      try {
        store.setItem(CLICK_QUEUE_KEY, JSON.stringify(pruneQueue(queue, Date.now(), QUEUE_TTL_MS)));
      } catch {
        /* full or blocked: in-memory state still works for this page view */
      }
    };

    const sessionId = () => {
      const store = storage('sessionStorage');
      if (!store) return '';
      try {
        let id = store.getItem(SESSION_KEY);
        if (!id) {
          id = typeof window.crypto?.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
          store.setItem(SESSION_KEY, id);
        }
        return id;
      } catch {
        return '';
      }
    };

    // A click event must not be allowed to delay the navigation, so it is
    // fire-and-forget and never awaited.
    const send = (path, payload, keepalive) => {
      const endpoint = readConfig().endpoint;
      const url = path === '' ? endpoint : `${endpoint.replace(/\/+$/, '')}${path}`;
      const body = JSON.stringify(payload);
      try {
        if (keepalive && typeof window.navigator.sendBeacon === 'function') {
          const blob = new window.Blob([body], { type: 'application/json' });
          if (window.navigator.sendBeacon(url, blob)) return Promise.resolve(true);
        }
        if (typeof window.fetch !== 'function') return Promise.resolve(false);
        return window.fetch(url, {
          method: 'POST',
          // The Pabbly listener allows Content-Type but not custom headers, so
          // the payload carries the event type itself rather than a header.
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: Boolean(keepalive),
          mode: 'cors',
          credentials: 'omit',
        }).then((response) => Boolean(response && response.ok)).catch(() => false);
      } catch {
        return Promise.resolve(false);
      }
    };

    // The endpoint is configuration, not behaviour: it lives on the form when
    // there is one (index.html) and on the document when there is not
    // (resume.html). An empty value means tracking is off.
    const readConfig = () => {
      const form = document.getElementById('contactForm');
      const configured = (form && form.getAttribute('data-track-endpoint'))
        || document.documentElement.getAttribute('data-track-endpoint')
        || '';
      return {
        endpoint: configured,
        mode: endpointMode(configured),
        hostname: window.location.hostname,
        // Test-only seam: never set by markup, so a page cannot enable it.
        allowLocal: window.__portfolioTrackingTestMode === true,
        globalPrivacyControl: window.navigator.globalPrivacyControl === true,
        doNotTrack: window.navigator.doNotTrack || window.doNotTrack || '',
      };
    };

    const trackClick = (channel) => {
      if (!shouldTrack(readConfig())) return;
      const event = buildClickEvent(channel, window.location.pathname, sessionId(), Date.now());
      writeQueue(readQueue().concat([event])); // the count is kept either way
      // Calling the automation directly, one request per click would hand it
      // data about a visitor who has not contacted anyone. The count stays
      // local and travels with the submission instead.
      if (readConfig().mode === 'direct') return;
      send('/event', event, true); // best effort; failure is invisible by design
    };

    const submit = (fields) => {
      const config = readConfig();
      if (!shouldTrack(config)) return Promise.resolve(false);
      // Copied *before* awaiting, so a click landing mid-request cannot clear a
      // queue that was already read.
      const clicks = readQueue();
      const context = {
        page: window.location.pathname,
        referrer: document.referrer || '',
        sessionId: sessionId(),
        utm: pickUtm(window.location.search),
        clicks,
        browser: readBrowserContext(window),
      };

      if (config.mode === 'direct') {
        // One request, straight to the workflow, no relay in between.
        return send('', buildWebhookPayload(fields, context), false).then((ok) => {
          if (ok) writeQueue([]);
          return ok;
        });
      }

      const payload = buildSubmission(fields, context);
      return send('/submit', payload, false).then((ok) => {
        if (ok) writeQueue([]); // only clear once the relay has accepted it
        return ok;
      });
    };

    const wireClicks = () => {
      document.addEventListener('click', (event) => {
        const target = event.target instanceof window.Element ? event.target.closest('[data-track]') : null;
        if (!target) return;
        const channel = target.getAttribute('data-track-channel');
        if (channel) trackClick(channel);
      }, { capture: true });
    };

    return {
      shouldTrack: () => shouldTrack(readConfig()),
      trackClick,
      submit,
      readQueue,
      wire: wireClicks,
    };
  }

  const api = {
    // pure, for tests and for the relay contract
    isConfigured,
    isLocalHost,
    shouldTrack,
    pickUtm,
    buildClickEvent,
    buildSubmission,
    buildWebhookPayload,
    endpointMode,
    readBrowserContext,
    pruneQueue,
    isHoneypotFilled,
    createRuntime,
    CLICK_QUEUE_KEY,
    MAX_QUEUE,
    QUEUE_TTL_MS,
  };

  if (typeof globalThis !== 'undefined' && globalThis.module && globalThis.module.exports) {
    globalThis.module.exports = api;
  }
  if (typeof window !== 'undefined' && document !== undefined) {
    window.PortfolioTracking = Object.assign(api, { runtime: null });
    const start = () => {
      if (window.PortfolioTracking.runtime) return null; // start once, whatever wakes us
      const runtime = createRuntime(window, document);
      window.PortfolioTracking.runtime = runtime;
      // A page may have no form at all — resume.html has tracked links and no
      // input — so the runtime is always built and only the endpoint decides
      // whether anything is sent.
      if (runtime.shouldTrack()) runtime.wire();
      return runtime;
    };
    window.PortfolioTracking.start = start;
    // This file is loaded with `defer`, so the document is already parsed by
    // the time it runs; start immediately and keep the DOMContentLoaded path
    // only for a caller that evaluates it early.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }
}());
