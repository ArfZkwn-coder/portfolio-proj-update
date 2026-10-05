/* Portfolio interactions — Arif Zakwan
 *
 * Progressive enhancement: every feature checks for what it depends on
 * (Lenis, GSAP, WebGL, a fine pointer, the reduced-motion preference) and
 * quietly skips itself when that is missing. The page is fully usable
 * without any of it.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const pad2 = (n) => String(n).padStart(2, '0');

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  const desktopQuery = window.matchMedia('(min-width: 901px)');
  const prefersReducedMotion = () => motionQuery.matches;

  /* ------------------------------------------------------------------ */
  /* Smooth scroll (Lenis) — optional                                    */
  /* ------------------------------------------------------------------ */
  function initSmoothScroll() {
    if (prefersReducedMotion() || typeof window.Lenis !== 'function') return null;

    const lenis = new window.Lenis({ lerp: 0.1 });
    const { gsap, ScrollTrigger } = window;

    if (gsap && ScrollTrigger) {
      // One clock for both libraries keeps scrubbed animations in sync.
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const raf = (time) => {
        lenis.raf(time);
        requestAnimationFrame(raf);
      };
      requestAnimationFrame(raf);
    }
    return lenis;
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */
  function initMenu(lenis) {
    const button = $('#hamburger');
    const menu = $('#mobileMenu');
    if (!button || !menu) return { close: () => {} };

    const links = $$('a', menu);
    let isOpen = false;

    const externalClick = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && !menu.contains(target) && !button.contains(target)) setOpen(false);
    };

    // A modal panel needs focus somewhere useful inside it, so open by focusing
    // the first link and keep Tab cycling within the menu until it closes.
    const trapTab = (event) => {
      if (event.key !== 'Tab' || links.length === 0) return;
      const first = links[0];
      const last = links[links.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !menu.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !menu.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    const setOpen = (open) => {
      if (open === isOpen) return;
      isOpen = open;
      button.classList.toggle('open', open);
      menu.classList.toggle('open', open);
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.inert = !open; // keeps invisible links out of the tab order
      root.classList.toggle('menu-open', open);
      if (lenis) {
        if (open) lenis.stop();
        else lenis.start();
      }

      if (open) {
        const first = links[0];
        if (first) first.focus();
        document.addEventListener('click', externalClick);
        document.addEventListener('keydown', trapTab, true);
      } else {
        document.removeEventListener('click', externalClick);
        document.removeEventListener('keydown', trapTab, true);
        // The button is the only sensible place to land, whatever was focused
        // when the menu opened.
        button.focus();
      }
    };

    button.addEventListener('click', () => setOpen(!isOpen));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen) setOpen(false);
    });
    desktopQuery.addEventListener('change', (event) => {
      if (event.matches) setOpen(false);
    });

    return { close: () => setOpen(false) };
  }

  function initAnchors(lenis, closeMenu) {
    $$('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', (event) => {
        const hash = link.getAttribute('href');
        const target = hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
        if (!target) return;

        // The skip link is an escape hatch for keyboard users: jump instantly and
        // move focus, rather than animating the viewport under them.
        if (link.classList.contains('skip-link')) {
          event.preventDefault();
          closeMenu();
          history.replaceState(null, '', hash);
          target.focus({ preventScroll: true });
          target.scrollIntoView({ behavior: 'auto', block: 'start' });
          return;
        }

        event.preventDefault();
        closeMenu();
        if (lenis) lenis.scrollTo(target, { duration: 1.2 });
        else target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        history.replaceState(null, '', hash);
      });
    });
  }

  function initNav() {
    const nav = $('#nav');
    if (!nav) return;

    const progress = $('#navProgress');
    let ticking = false;

    // One scroll listener feeds both the "scrolled" style and the reading-progress
    // hairline, so the page keeps a single passive handler.
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 60);
      if (!progress) return;
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const value = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
        progress.style.setProperty('--nav-progress', value.toFixed(4));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    if (!('IntersectionObserver' in window)) return;

    // A thin band across the middle of the viewport decides the active section,
    // so tall sections (mobile) can never get "stuck" below a visibility threshold.
    const links = $$('.nav-links a');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => {
            const isCurrent = link.getAttribute('href') === `#${entry.target.id}`;
            link.classList.toggle('active', isCurrent);
            if (isCurrent) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
          });
        });
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );
    $$('main section[id]').forEach((section) => observer.observe(section));
  }

  /* ------------------------------------------------------------------ */
  /* Cursor + magnetic buttons (fine pointers only)                      */
  /* ------------------------------------------------------------------ */
  function initCursor() {
    if (!pointerQuery.matches) return;
    const dot = $('#cursor');
    const ring = $('#cursorRing');
    const label = $('#cursorLabel');
    if (!dot || !ring || !label) return;

    root.classList.add('has-cursor');

    let mouseX = -100;
    let mouseY = -100;
    let ringX = mouseX;
    let ringY = mouseY;
    let seenFirstMove = false;

    const place = (element, x, y) => {
      element.style.setProperty('--x', `${x}px`);
      element.style.setProperty('--y', `${y}px`);
    };

    document.addEventListener('pointermove', (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      if (!seenFirstMove) {
        seenFirstMove = true;
        ringX = mouseX;
        ringY = mouseY;
      }
      place(dot, mouseX, mouseY);
    });

    const follow = () => {
      ringX += (mouseX - ringX) * 0.12;
      ringY += (mouseY - ringY) * 0.12;
      place(ring, ringX, ringY);
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);

    document.addEventListener('pointerover', (event) => {
      const target = event.target instanceof Element ? event.target.closest('a, button, [data-cursor]') : null;
      const text = target && target.dataset.cursor ? target.dataset.cursor : '';
      dot.classList.toggle('hover', Boolean(target));
      dot.classList.toggle('is-hidden', Boolean(text));
      ring.classList.toggle('hover', Boolean(target) && !text);
      ring.classList.toggle('has-label', Boolean(text));
      label.textContent = text;
    });

    root.addEventListener('mouseleave', () => {
      dot.style.opacity = '0';
      ring.style.opacity = '0';
    });
    root.addEventListener('mouseenter', () => {
      dot.style.opacity = '';
      ring.style.opacity = '';
    });
  }

  function initMagnetic() {
    if (!pointerQuery.matches || prefersReducedMotion()) return;

    $$('.hero-cta, .hero-cta-secondary, .form-submit').forEach((element) => {
      element.addEventListener('pointermove', (event) => {
        const rect = element.getBoundingClientRect();
        const x = (event.clientX - (rect.left + rect.width / 2)) * 0.25;
        const y = (event.clientY - (rect.top + rect.height / 2)) * 0.35;
        element.style.setProperty('--mx', `${x}px`);
        element.style.setProperty('--my', `${y}px`);
      });
      element.addEventListener('pointerleave', () => {
        element.style.removeProperty('--mx');
        element.style.removeProperty('--my');
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Intro: preloader + kinetic hero name                                */
  /* ------------------------------------------------------------------ */

  // Wraps every character in masked spans for the staggered reveal. The
  // original text stays available to assistive tech through aria-label.
  function splitChars(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
    element.setAttribute('aria-label', clone.textContent.replace(/\s+/g, ' ').trim());

    let index = 0;
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          const fragment = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              fragment.appendChild(document.createTextNode(' '));
              return;
            }
            const word = document.createElement('span');
            word.className = 'word';
            word.setAttribute('aria-hidden', 'true');
            Array.from(part).forEach((character) => {
              const char = document.createElement('span');
              char.className = 'char';
              char.style.setProperty('--i', String(index));
              char.textContent = character;
              word.appendChild(char);
              index += 1;
            });
            fragment.appendChild(word);
          });
          node.replaceChild(fragment, child);
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') {
          walk(child);
        }
      });
    };
    walk(element);
  }

  // The preloader plays once per browser session; repeat visits go straight to the page.
  // sessionStorage can throw (blocked storage), so both helpers fail soft.
  function introAlreadySeen() {
    try { return sessionStorage.getItem('intro-seen') === '1'; } catch { return false; }
  }
  function markIntroSeen() {
    try { sessionStorage.setItem('intro-seen', '1'); } catch { /* storage blocked: intro simply plays again next time */ }
  }

  function runIntro() {
    const counter = $('#preloaderCount');
    if (!counter || prefersReducedMotion() || introAlreadySeen()) return Promise.resolve();

    const minDuration = 1100;
    const start = performance.now();
    let done = false;

    const tick = (now) => {
      if (done) return;
      const progress = clamp((now - start) / minDuration, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      counter.textContent = String(Math.round(eased * 99)).padStart(3, '0');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const fontsReady = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, wait(2500)]) : Promise.resolve();

    return Promise.all([fontsReady, wait(minDuration)]).then(() => {
      done = true;
      counter.textContent = '100';
      markIntroSeen();
      return wait(250);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Reveal-on-scroll, marquee                                           */
  /* ------------------------------------------------------------------ */
  function initReveal() {
    const items = $$('.reveal');
    if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
      items.forEach((item) => item.classList.add('visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries
          .filter((entry) => entry.isIntersecting)
          .forEach((entry, i) => {
            setTimeout(() => entry.target.classList.add('visible'), i * 80);
            observer.unobserve(entry.target);
          });
      },
      { threshold: 0.1 }
    );
    items.forEach((item) => observer.observe(item));
  }

  // Drifts constantly; speeds up and reverses with scroll velocity/direction.
  function initMarquee() {
    const marquee = $('.marquee');
    const track = marquee && $('.marquee-track', marquee);
    if (!track || prefersReducedMotion() || !('IntersectionObserver' in window)) return;

    marquee.classList.add('is-driven');

    let offset = 0;
    let direction = -1;
    let velocity = 0;
    let lastY = window.scrollY;
    let last = performance.now();
    let running = false;
    let frame = 0;

    const loop = (now) => {
      if (!running) return;
      const dt = Math.min(64, now - last) / 1000;
      last = now;

      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      velocity += (delta - velocity) * 0.1;
      if (delta !== 0) direction = delta > 0 ? -1 : 1;

      const speed = 60 + Math.min(Math.abs(velocity) * 40, 1200); // px per second
      offset += direction * speed * dt;

      const half = track.scrollWidth / 2; // two identical groups -> seamless wrap
      if (half > 0) {
        if (offset <= -half) offset += half;
        if (offset > 0) offset -= half;
      }
      track.style.transform = `translate3d(${offset}px, 0, 0)`;
      frame = requestAnimationFrame(loop);
    };

    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !running) {
        running = true;
        last = performance.now();
        lastY = window.scrollY;
        frame = requestAnimationFrame(loop);
      } else if (!entry.isIntersecting) {
        running = false;
        cancelAnimationFrame(frame);
      }
    }).observe(marquee);
  }

  /* ------------------------------------------------------------------ */
  /* GSAP scroll effects — optional                                      */
  /* ------------------------------------------------------------------ */
  function initScrollEffects() {
    const { gsap, ScrollTrigger } = window;
    if (!gsap || !ScrollTrigger || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);

    const hero = $('#hero');
    if (hero && desktopQuery.matches) {
      const scrollTrigger = { trigger: hero, start: 'top top', end: 'bottom top', scrub: true };
      gsap.to('.hero-right', { y: -70, ease: 'none', scrollTrigger });
      gsap.to('.hero-left', { y: 50, ease: 'none', scrollTrigger });
    }

    const timeline = $('.timeline');
    const bar = $('.timeline-progress');
    if (timeline && bar) {
      gsap.fromTo(
        bar,
        { scaleY: 0 },
        { scaleY: 1, ease: 'none', scrollTrigger: { trigger: timeline, start: 'top 70%', end: 'bottom 70%', scrub: true } }
      );
      $$('.timeline-item', timeline).forEach((item) => {
        ScrollTrigger.create({
          trigger: item,
          start: 'top 70%',
          onEnter: () => item.classList.add('is-active'),
          onLeaveBack: () => item.classList.remove('is-active'),
        });
      });
    }

    $$('.project-card').forEach((card) => {
      const index = $('.project-index', card);
      if (!index) return;
      gsap.to(index, {
        yPercent: -25,
        ease: 'none',
        scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: true },
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 3D skills totem — lazy, desktop + WebGL + motion allowed            */
  /* ------------------------------------------------------------------ */
  // Probed once: the answer cannot change mid-session, and each probe allocates
  // a canvas plus a WebGL context that is never explicitly released.
  let webglSupport;
  function hasWebGL() {
    if (webglSupport !== undefined) return webglSupport;
    try {
      const canvas = document.createElement('canvas');
      webglSupport = Boolean(canvas.getContext('webgl2'));
    } catch {
      webglSupport = false;
    }
    return webglSupport;
  }

  function wireTotem(totem, cards, grid) {
    const indexLabel = $('#totemIndex');
    const totalLabel = $('#totemTotal');
    if (totalLabel) totalLabel.textContent = `/ ${pad2(cards.length)}`;

    let active = -1;
    const setActive = (index) => {
      if (index === active || index < 0) return;
      active = index;
      cards.forEach((card, i) => card.classList.toggle('is-active', i === index));
      if (indexLabel) indexLabel.textContent = pad2(index + 1);
      totem.setActive(index);
    };
    setActive(0);

    // The card crossing the middle of the viewport is the active skill.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(cards.indexOf(entry.target));
        });
      },
      { rootMargin: '-45% 0px -45% 0px' }
    );
    cards.forEach((card) => observer.observe(card));

    let ticking = false;
    const updateProgress = () => {
      ticking = false;
      const rect = grid.getBoundingClientRect();
      totem.setProgress(clamp((window.innerHeight * 0.5 - rect.top) / Math.max(1, rect.height), 0, 1));
    };
    window.addEventListener(
      'scroll',
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateProgress);
      },
      { passive: true }
    );
    updateProgress();
  }

  async function startTotem(cards, grid) {
    root.classList.add('has-totem'); // makes the stage measurable before the canvas is sized
    try {
      const { createTotem } = await import('./totem.js');
      const skills = cards.map((card) => ({
        name: $('.skill-name', card).textContent.trim(),
        tag: $('.skill-tag', card).textContent.trim(),
      }));
      const totem = await createTotem({ container: $('#totemCanvas'), skills });
      wireTotem(totem, cards, grid);
    } catch (error) {
      root.classList.remove('has-totem');
      // Expected on desktops without WebGL or with module loading blocked, and
      // already covered by the static grid, so this is a developer signal rather
      // than noise in a visitor's console: opt in with `window.__portfolioDebug`.
      if (window.__portfolioDebug === true) {
        console.warn('3D totem unavailable, keeping the static skills grid.', error);
      }
    }
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  }

  function initTotem() {
    const section = $('#skills');
    const grid = $('#skillsGrid');
    const cards = grid ? $$('.skill-card', grid) : [];
    if (!section || cards.length === 0 || prefersReducedMotion() || !('IntersectionObserver' in window)) return;

    let started = false;
    const arm = () => {
      if (started || !desktopQuery.matches || !hasWebGL()) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (started || !entries.some((entry) => entry.isIntersecting)) return;
          started = true;
          observer.disconnect();
          startTotem(cards, grid);
        },
        { rootMargin: '600px 0px' }
      );
      observer.observe(section);
    };

    arm();
    desktopQuery.addEventListener('change', (event) => {
      if (event.matches) arm();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Contact form — inline validation + honest status                     */
  /* ------------------------------------------------------------------ */
  function initForm() {
    const form = $('#contactForm');
    const status = $('#formStatus');
    if (!form || !status) return;

    const submit = $('.form-submit', form);
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    // A "loading" endpoint that accepts the connection but never answers would
    // otherwise leave the button disabled and the form stuck busy forever.
    const submitTimeoutMs = 15000;

    const show = (message, isError = false) => {
      status.textContent = message;
      status.classList.add('show');
      status.classList.toggle('is-error', isError);
    };

    const setBusy = (busy) => {
      form.setAttribute('aria-busy', String(busy));
      form.classList.toggle('is-busy', busy);
      if (!submit) return;
      submit.setAttribute('aria-busy', String(busy));
      submit.disabled = busy;
    };

    // Fields that carry a required state (aria-required, or the native attribute)
    // also carry their own message, so the copy stays in the markup and
    // validation only decides whether to reveal it. The native-required fallback
    // keeps this resilient if the markup ever switches back.
    const requiredFields = $$('input, textarea, select', form)
      .filter((field) => field.getAttribute('aria-required') === 'true' || field.required === true)
      .map((field) => {
        const error = document.getElementById(`${field.id}-error`);
        return { field, error, message: error ? error.textContent.trim() : 'This field is required.' };
      });

    const problem = ({ field, message }) => {
      const value = field.value.trim();
      if (!value) return message;
      if (field.type === 'email' && !emailPattern.test(value)) {
        return 'Please check the email address — it looks incomplete.';
      }
      return '';
    };

    const validate = (entry) => {
      const issue = problem(entry);
      if (entry.error) {
        entry.error.hidden = !issue;
        if (issue) entry.error.textContent = issue;
      }
      if (issue) entry.field.setAttribute('aria-invalid', 'true');
      else entry.field.removeAttribute('aria-invalid');
      return !issue;
    };

    const clear = (entry) => {
      if (entry.error) entry.error.hidden = true;
      entry.field.removeAttribute('aria-invalid');
    };

    requiredFields.forEach((entry) => {
      entry.field.addEventListener('blur', () => validate(entry));
      entry.field.addEventListener('input', () => {
        if (entry.field.getAttribute('aria-invalid') === 'true') validate(entry);
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      if (data.get('company')) return; // honeypot: real people never fill this in

      const invalid = requiredFields.filter((entry) => !validate(entry));
      if (invalid.length) {
        show('Please fix the highlighted fields and try again.', true);
        invalid[0].field.focus();
        return;
      }

      const name = String(data.get('name') || '').trim();
      const email = String(data.get('email') || '').trim();
      const message = String(data.get('message') || '').trim();
      const topic = String(data.get('topic') || '').trim();
      const endpoint = form.dataset.endpoint;

      // The webhook relay (js/tracking.js) is a parallel delivery path: it carries
      // the submission plus the outbound clicks that led to it. It never gates
      // the visitor — if it is unconfigured or fails, the paths below still run.
      const tracking = window.PortfolioTracking && window.PortfolioTracking.runtime;
      if (tracking) tracking.submit({ name, email, message, topic });

      if (endpoint) {
        setBusy(true);
        try {
          // Guarded, because not every engine implements the static helper.
          const canTimeout = typeof AbortSignal === 'function' && typeof AbortSignal.timeout === 'function';
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: data,
            signal: canTimeout ? AbortSignal.timeout(submitTimeoutMs) : undefined,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          form.reset();
          requiredFields.forEach(clear);
          show("Message sent. I'll get back to you soon.");
        } catch {
          show('That did not go through. Please email me directly at arifzakwan2001@gmail.com.', true);
        } finally {
          setBusy(false);
        }
        return;
      }

      // No endpoint configured: hand off to the visitor's mail app. The form is
      // NOT reset, so nothing typed is lost if no mail app opens.
      const subject = `Portfolio enquiry${topic ? `: ${topic}` : ''} (from ${name})`;
      const body = `${message}\n\n${topic ? `Topic: ${topic}\n` : ''}From: ${name}\nEmail: ${email}`;
      window.location.href = `mailto:arifzakwan2001@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      show('Opening your email app. If nothing opens, write to arifzakwan2001@gmail.com directly.');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Case-study dialogs — deep-linkable, keyboard-first                  */
  /* ------------------------------------------------------------------ */
  function initCaseStudies(lenis) {
    const dialogs = $$('dialog.case-study');
    if (dialogs.length === 0 || typeof HTMLDialogElement === 'undefined'
      || typeof HTMLDialogElement.prototype.showModal !== 'function') return;

    const bySlug = new Map();
    dialogs.forEach((dialog) => bySlug.set(dialog.id.replace(/^case-/, ''), dialog));

    let current = null;
    let opener = null;

    // Same lock the mobile menu uses: one place decides whether the page can
    // scroll, so two overlapping overlays cannot leave it stuck.
    const setLocked = (locked) => {
      root.classList.toggle('case-open', locked);
      if (!lenis) return;
      if (locked) lenis.stop();
      else lenis.start();
    };

    const open = (slug, trigger) => {
      const dialog = bySlug.get(slug);
      if (!dialog || current === dialog) return;
      // Keep the previous opener until the new one is recorded, so closing the
      // outgoing panel during a swap cannot bounce focus to a stale control.
      const previousOpener = opener;
      close({ restoreFocus: false });
      opener = trigger || previousOpener || null;
      current = dialog;
      dialog.scrollTop = 0;
      dialog.showModal();
      setLocked(true);
      const heading = $('.case-study-title', dialog);
      if (heading) heading.focus({ preventScroll: true });
    };

    const close = ({ restoreFocus = true } = {}) => {
      const dialog = current;
      if (!dialog) return;
      current = null;
      if (dialog.open) dialog.close();
      setLocked(false);
      const back = opener;
      opener = null;
      if (restoreFocus && back && document.contains(back)) back.focus();
    };

    // The hash is the single source of truth for which case study is open, so
    // the back button, a shared link and a click all take the same path. Each
    // panel is individually shorable as #case-<slug>.
    const syncFromHash = () => {
      const slug = (window.location.hash || '').replace(/^#case-/, '');
      if (window.location.hash.startsWith('#case-') && bySlug.has(slug)) {
        // Arriving by URL rather than by click: there is no control to return to.
        const trigger = document.querySelector(`.project-case-open[data-case="${slug}"]`);
        open(slug, trigger);
      } else {
        close();
      }
    };

    $$('.project-case-open').forEach((button) => {
      button.addEventListener('click', () => {
        const slug = button.dataset.case;
        if (!slug || !bySlug.has(slug)) return;
        opener = button;
        const hash = `#case-${slug}`;
        if (window.location.hash === hash) open(slug, button);
        else window.history.pushState(null, '', hash);
        syncFromHash();
      });
    });

    dialogs.forEach((dialog) => {
      const requestClose = () => {
        if (window.location.hash) window.history.back();
        else close();
      };
      $('.case-study-close', dialog)?.addEventListener('click', requestClose);
      // The platform fires `cancel` for Escape; routing it through the same
      // history path keeps the URL and the visible panel in step.
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        requestClose();
      });
      // Backdrop clicks land on the dialog element itself, never on its content.
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) requestClose();
      });
      // A closed dialog must not keep the page locked.
      dialog.addEventListener('close', () => setLocked(false));
    });

    window.addEventListener('hashchange', syncFromHash);
    window.addEventListener('popstate', syncFromHash);
    syncFromHash();
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());

  const lenis = initSmoothScroll();
  const menu = initMenu(lenis);
  initAnchors(lenis, menu.close);
  initNav();
  initCursor();
  initMagnetic();
  initReveal();
  initMarquee();
  initForm();
  initCaseStudies(lenis);

  const heroName = $('.hero-name');
  if (heroName) splitChars(heroName);

  initScrollEffects();
  initTotem();

  runIntro().then(() => {
    root.classList.remove('is-loading');
    root.classList.add('is-ready');
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  });
})();
