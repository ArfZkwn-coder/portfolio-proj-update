# Arif Zakwan — Portfolio

Live: https://arfzkwn-coder.github.io/portfolio-proj

Single-page portfolio for an IT enthusiast and automation specialist, plus a print-first résumé page. Plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages straight from the repo root. Motion and 3D are progressive enhancements: if a library, WebGL, a fine pointer or motion is unavailable (or the visitor prefers reduced motion), that feature skips itself and the page still works.

## Structure

```
index.html            the portfolio — all page content (edit your text here)
resume.html           print-first résumé, built from the same copy
404.html              GitHub Pages fallback; pins <base> because it is served at any depth
css/tokens.css        the only place colours, sizes, space and motion are declared
css/style.css         index.html + 404.html component styles, incl. print rules
css/resume.css        résumé layout + its A4 print rules
js/main.js            scroll, nav, cursor, intro, form, case-study dialogs, totem loader
js/totem.js           Three.js skills "totem" (lazy-loaded, desktop + WebGL only)
robots.txt            allows crawling, points at the sitemap
sitemap.xml           the two real pages (maintained by hand — keep lastmod honest)
.nojekyll             stop Pages from running Jekyll over the output
og-image.png          social preview (1200×630)
test/                 dev-only checks (not needed to run the site)
package.json          dev tooling only
```

## Design tokens

Every colour, size, space, radius and duration lives in the `:root` blocks in
`css/tokens.css`, which every page loads **before** its own stylesheet. Nothing
outside a `:root` block may hard-code a colour — a test fails if it does, and
`test/contrast.test.mjs` re-computes the WCAG 2.1 contrast ratio of every
text/background pair in the palette (light **and** the
`prefers-color-scheme: dark` override).

Practical consequences when editing:

- **Accent tiers.** `--accent` is the *text* accent on light surfaces (≥4.5:1, safe
  at any size). `--accent-on-dark` is for text on dark surfaces.
  `--accent-bright` is decorative only (rules, dots, 3D) and is never used for
  small text.
- **Inverted surfaces** use the fixed `--solid`/`--solid-text` pair, not
  `--ink`/`--paper`. That keeps buttons and the dark Skills panel cream-on-dark
  in both colour schemes.
- **Modal surfaces** use `--dialog-surface`/`--dialog-text`/`--scrim`.
- **Type scale.** Use `--fs-*`; a test rejects a new ad-hoc `font-size`. The
  résumé's print rules are the one exception, because paper wants `pt`.
- **Dynamic custom properties.** `--i`, `--x`, `--y`, `--mx`, `--my` and
  `--nav-progress` are written by `js/main.js` and only read by CSS; they are
  listed in `test/stylesheet.test.mjs`.
- **A token that resolves to itself is a bug**, not a no-op: `--x: var(--x)`
  computes to nothing and silently drops the declaration. A test fails on it.

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

## Case studies

Each project card has a "Read case study" control that opens a native `<dialog>`
with the problem, how it works, the outcome and the stack. The panels are part of
`index.html`, so they are crawlable and work as plain content even without the
dialog API.

- **Deep links:** every panel is `#case-<slug>`, where the slug comes from the
  card's `data-case`. Opening pushes a history entry; closing, Escape and a
  backdrop click go back through it, so the URL and the visible panel cannot
  disagree.
- **Authoring rule:** the dialog copy is the card's own text, expanded. A test
  (`test/case-studies.test.mjs`) asserts the dialog's outcome and stack match the
  card **verbatim**, so the two cannot drift. If you reword a card, reword the
  panel in the same edit.
- **No invented facts:** there are deliberately no project URLs yet. The only
  link in a panel is the contact address, and a test fails if any other URL
  ships. Add a real repo or demo link to `.case-study-links` when you have one.
- **Without JS**, or in a browser without `showModal`, the openers stay hidden
  and the cards render exactly as before.

## Résumé

[resume.html](resume.html) is the one-page version, assembled from the same facts
as the portfolio (3 roles, 6 skills, 3 projects, 3 qualifications). It is static
HTML with a two-line inline script for the print button — no dependency on
`js/main.js`.

- **Make a PDF:** open the page, click *Download as PDF*, and choose "Save as
  PDF" as the destination. Nothing is generated or stored; there is intentionally
  no committed `resume.pdf` binary to keep in sync.
- **Print rules:** `@media print` in `css/resume.css` pins `@page size: A4`,
  hides the toolbar and skip link, keeps headings from being orphaned and
  entries from being split, and prints link targets.
- `index.html` also has a print block, so printing the portfolio is readable
  rather than a stack of blank reveals.

## Editing

- All portfolio text lives in `index.html`. If you add or remove a skill, update the hard-coded `/ 06` totem counter in the Skills section; `npm test` fails if it drifts.
- Update `sitemap.xml`'s `<lastmod>` by hand when you change a page — there is no build step to generate it, and a wrong date is worse than none.
- Keep asset paths **relative** (`css/style.css`, not `/css/style.css`). Pages serves this site under `/portfolio-proj/`, so root-absolute paths 404. Tests enforce this in the HTML and the CSS. `404.html` is the single exception and uses `<base href="/portfolio-proj/">`.
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

The suites are run with `node --test` from `test/`, so their relative reads work —
run `npm test`, or `cd test` first.

| File | Guards |
| --- | --- |
| `test/main.smoke.test.mjs` | boot without libraries, menu focus trap, reveal/nav observers, form validation + busy state, cursor, reduced motion, case-study open/close/deep-link, totem success/failure, intro session logic |
| `test/site.integrity.test.mjs` | relative asset paths, absolute SEO metadata, no placeholders, real content, section/nav order, accessibility plumbing, résumé content and cross-links, JSON-LD parity |
| `test/contrast.test.mjs` | WCAG AA contrast for every pair in the palette, in both colour schemes |
| `test/stylesheet.test.mjs` | balanced braces, every `var()` resolves, no self-referential token, no unused token, no raw colour in a component rule, no ad-hoc font sizes |
| `test/case-studies.test.mjs` | one opener per card, labelled dialog + close control, card ↔ dialog copy cannot drift, no stray URLs |
| `test/static-site.test.mjs` | robots ↔ sitemap agreement, sitemap entries resolve to real files, 404 is no-indexed and self-contained, `.nojekyll` present |
| `test/totem.test.mjs` | the 3D layout/rotation/paint math |
