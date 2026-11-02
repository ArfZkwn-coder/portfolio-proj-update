/* Portfolio interactions — Arif Zakwan
 *
 * Progressive enhancement: every feature checks for what it depends on
 * (Lenis, GSAP, a fine pointer, the reduced-motion preference) and
 * quietly skips itself when that is missing. The page is fully usable
 * without any of it.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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
  /* Kinetic hero name                                                   */
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

  /* ------------------------------------------------------------------ */
  /* Reveal-on-scroll                                                    */
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
  }

  /* ------------------------------------------------------------------ */
  /* Diagrams — the pipelines draw themselves once they are on screen    */
  /* ------------------------------------------------------------------ */
  // The hidden first frame lives under `html.motion`, which is only added
  // here. No JS, no IntersectionObserver, or a reduced-motion preference all
  // mean the class is never added and the finished drawing shows instead.
  // Returns a function that draws whatever is on screen already: the observer
  // needs rendering frames, and a background tab produces none, so the boot
  // sequence calls it once rather than trusting a callback to arrive.
  function initDiagrams() {
    const diagrams = $$('.diagram');
    if (diagrams.length === 0 || prefersReducedMotion() || !('IntersectionObserver' in window)) {
      return () => {};
    }

    const draw = (diagram) => {
      if (diagram.classList.contains('draw')) return;
      diagram.classList.add('draw');
      $$('.box, .wire, .wire-accent, .wire-dash', diagram).forEach((part, index) => {
        part.style.setProperty('--d', `${Math.min(index, 7) * 90}ms`);
      });
    };

    root.classList.add('motion');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          draw(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.35 }
    );
    diagrams.forEach((diagram) => observer.observe(diagram));

    return () => {
      diagrams
        .filter((diagram) => {
          const rect = diagram.getBoundingClientRect();
          return rect.top < window.innerHeight && rect.bottom > 0;
        })
        .forEach(draw);
    };
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

      const tracking = window.PortfolioTracking && window.PortfolioTracking.runtime;

      // A Formspree/Web3Forms endpoint (data-endpoint) takes precedence when it is
      // configured — it is the one path that posts the raw FormData.
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

      // Otherwise the relay (js/tracking.js) is the primary delivery path: it
      // carries the message plus the outbound clicks that led to it, and the page
      // reports success or failure from the relay's answer. The typed message is
      // kept on failure so it can be copied into a direct email.
      const canSend = tracking && typeof tracking.shouldTrack === 'function' && tracking.shouldTrack();
      if (canSend) {
        setBusy(true);
        try {
          const delivered = await Promise.race([
            tracking.submit({ name, email, message, topic }),
            new Promise((resolve) => setTimeout(() => resolve(false), submitTimeoutMs)),
          ]);
          if (!delivered) throw new Error('the relay did not accept the submission');
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

      // No endpoint and no relay: hand off to the visitor's mail app. The form is
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
        // The marker tells requestClose() this entry is ours to go back to.
        else window.history.pushState({ caseStudy: true }, '', hash);
        syncFromHash();
      });
    });

    dialogs.forEach((dialog) => {
      // A panel opened from a shared #case- URL sits on the tab's first history
      // entry, where history.back() has nowhere to go. Relying on it would leave
      // the dialog open and the page locked with no way out, so only the entries
      // this script pushed are closed by going back; a deep link is closed by
      // clearing its hash in place instead.
      const requestClose = () => {
        if (window.history.state && window.history.state.caseStudy) {
          window.history.back();
          return;
        }
        if (window.location.hash) {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        }
        close();
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
  initForm();
  initCaseStudies(lenis);

  const heroName = $('.hero-name');
  if (heroName) splitChars(heroName);

  initScrollEffects();
  const drawDiagramsInView = initDiagrams();

  // No preloader: the hero entrance starts as soon as the name is split. The
  // layout read commits the characters' hidden starting position first, or
  // the browser would skip straight to the end state with no transition.
  if (heroName) void heroName.offsetWidth;
  root.classList.add('is-ready');
  if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  drawDiagramsInView();
})();
