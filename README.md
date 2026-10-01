# Arif Zakwan — Portfolio

Live: https://arfzkwn-coder.github.io/portfolio-proj

Single-page portfolio for an IT enthusiast and automation specialist. Plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages straight from the repo root. Motion and 3D are progressive enhancements: if a library, WebGL, a fine pointer or motion is unavailable (or the visitor prefers reduced motion), that feature skips itself and the page still works.

## Structure

```
index.html            page content (edit your text here)
css/style.css         design tokens + all component styles
js/main.js            scroll, nav, cursor, intro, form, totem loader
js/totem.js           Three.js skills "totem" (lazy-loaded, desktop + WebGL only)
og-image.png          social preview (1200×630)
test/                 dev-only checks (not needed to run the site)
package.json          dev tooling only
```

## Design tokens

Every colour, size, space, radius and duration lives in the `:root` block at the
top of `css/style.css` under `1. DESIGN TOKENS`. Nothing below that block may
hard-code a colour — a test fails if it does, and `test/contrast.test.mjs`
re-computes the WCAG 2.1 contrast ratio of every text/background pair in the
palette (light **and** the `prefers-color-scheme: dark` override).

Practical consequences when editing:

- **Accent tiers.** `--accent` is the *text* accent on light surfaces (≥4.5:1, safe
  at any size). `--accent-on-dark` is for text on dark surfaces.
  `--accent-bright` is decorative only (rules, dots, 3D) and is never used for
  small text.
- **Inverted surfaces** use the fixed `--solid`/`--solid-text` pair, not
  `--ink`/`--paper`. That keeps buttons and the dark Skills panel cream-on-dark
  in both colour schemes.
- **Type scale.** Use `--fs-*`; a test rejects a new ad-hoc `font-size`.
- **Dynamic custom properties.** `--i`, `--x`, `--y`, `--mx`, `--my` and
  `--nav-progress` are written by `js/main.js` and only read by CSS; they are
  listed in `test/stylesheet.test.mjs`.

## What's in it

- **Motion:** Lenis smooth scroll + GSAP ScrollTrigger, preloader (plays once per browser session, skipped on repeat visits) and kinetic hero name, marquee, scroll reveals
- **Interaction:** custom cursor with an "Open" label on the GitHub and LinkedIn links, and magnetic buttons (fine pointers only)
- **3D:** the Skills section becomes a scroll-driven Three.js totem on desktop; everyone else gets the static grid. The totem is built from the `.skill-card` elements, so editing a skill in `index.html` updates it.
- **Sections** (in this order): About, Projects, Skills, Experience, Education & Certifications, Contact. Numbers and nav order are checked by tests; if you reorder, keep both in sync.
- **Navigation:** a hairline reading-progress bar under the bar on scroll, and an
  active-section indicator driven by an IntersectionObserver band across the
  middle of the viewport.
- **Accessibility:** skip link (instant jump + focus), the mobile menu is a real
  `role="dialog"` with a focus trap and focus restoration, ink-on-surface focus
  rings everywhere, 44px touch targets, inline per-field form errors wired with
  `aria-invalid`/`aria-describedby`, `aria-busy` while a submission is in flight,
  reduced-motion support, honest form status. Decorative SVGs are `aria-hidden`
  and their accent comes from `stroke="currentColor"`.
- **Dark mode:** follows `prefers-color-scheme` with no JavaScript and no toggle.
- Libraries load from jsDelivr at pinned versions, deferred: GSAP 3.15.0, Lenis 1.3.26, three 0.186.1

## Editing

- All text lives in `index.html`. If you add or remove a skill, update the hard-coded `/ 06` totem counter in the Skills section; `npm test` fails if it drifts.
- Keep asset paths **relative** (`css/style.css`, not `/css/style.css`). Pages serves this site under `/portfolio-proj/`, so root-absolute paths 404. Tests enforce this in the HTML and the CSS.
- **Contact form:** visitors choose what they're reaching out about (job opportunity, freelance project, other); it appears in the email subject/body and is sent as a `topic` field. The form owns its validation (the markup sets `novalidate`) so errors appear inline and are announced — keep the `.field-error` element and `aria-describedby` on any required field you add. Paste a Formspree or Web3Forms URL into the form's `data-endpoint` to send without opening a mail app. Left empty, it opens the visitor's mail app instead.

## Run locally

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

Use a server rather than opening the file directly: the totem is an ES module and browsers block those on `file://`.

## Checks

```bash
npm install
npm run check      # eslint + html-validate + tests
```

The suite covers:

| File | Guards |
| --- | --- |
| `test/main.smoke.test.mjs` | boot without libraries, menu focus trap, reveal/nav observers, form validation + busy state, cursor, reduced motion, totem success/failure paths, intro session logic |
| `test/site.integrity.test.mjs` | relative asset paths, absolute SEO metadata, no placeholders, real content, section/nav order, accessibility plumbing, option values |
| `test/contrast.test.mjs` | WCAG AA contrast for every pair in the palette, in both colour schemes |
| `test/stylesheet.test.mjs` | balanced braces, every `var()` resolves, no unused tokens, no ad-hoc font sizes, relative asset URLs |
| `test/totem.test.mjs` | the 3D layout/rotation/paint math |
