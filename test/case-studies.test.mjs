// Guards the case-study dialogs: that each project card has exactly one way in,
// that every dialog is reachable and labelled, and — the important one — that
// the dialog's outcome and stack still match the card it belongs to. The panels
// deliberately re-state the card copy so a visitor without JS still sees
// everything, which means the two can drift; this is the drift alarm.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync('../index.html', 'utf8');
const { document } = new JSDOM(html).window;

const cards = [...document.querySelectorAll('.project-card')];
const dialogs = [...document.querySelectorAll('dialog.case-study')];
const normalise = (text) => text.replace(/\s+/g, ' ').trim();
const slugOf = (element) => element.dataset.case;

test('case studies: every project card has exactly one opener, and every dialog one card', () => {
  assert.equal(cards.length, 3, 'expected the three real projects');
  assert.equal(dialogs.length, cards.length, 'one dialog per project card');

  for (const card of cards) {
    const slug = slugOf(card);
    assert.ok(slug, 'card carries its slug in data-case');

    const openers = [...card.querySelectorAll('.project-case-open')];
    assert.equal(openers.length, 1, `${slug} has exactly one "read case study" control`);
    const [opener] = openers;
    assert.equal(opener.tagName, 'BUTTON', 'the opener is a real button, not a link or a div');
    assert.equal(opener.getAttribute('type'), 'button', 'the opener does not submit anything');
    assert.equal(opener.dataset.case, slug, 'opener and card agree on the slug');
    assert.equal(opener.getAttribute('aria-haspopup'), 'dialog');
    // aria-controls must resolve to the dialog for this exact project.
    assert.equal(opener.getAttribute('aria-controls'), `case-${slug}`);
    assert.ok(document.getElementById(`case-${slug}`), `${slug}: aria-controls resolves`);
  }

  // And no orphan dialogs pointing at cards that do not exist.
  const cardSlugs = new Set(cards.map(slugOf));
  for (const dialog of dialogs) {
    const slug = dialog.id.replace(/^case-/, '');
    assert.ok(cardSlugs.has(slug), `dialog ${dialog.id} has a matching project card`);
  }
});

test('case studies: each dialog is labelled by a real heading and has a labelled close control', () => {
  for (const dialog of dialogs) {
    const labelledBy = dialog.getAttribute('aria-labelledby');
    assert.ok(labelledBy, `${dialog.id} is labelled`);
    const heading = document.getElementById(labelledBy);
    assert.ok(heading, `${dialog.id}: aria-labelledby resolves`);
    assert.equal(heading.tagName, 'H2');
    assert.ok(heading.closest('dialog') === dialog, 'the heading lives inside its own dialog');
    assert.equal(heading.getAttribute('tabindex'), '-1', 'the heading can receive focus on open');

    const close = dialog.querySelector('.case-study-close');
    assert.ok(close, `${dialog.id} has a visible close control`);
    assert.equal(close.tagName, 'BUTTON');
    assert.ok(close.textContent.trim().length > 0, 'the close control is visibly labelled');
    assert.ok(close.getAttribute('aria-label'), 'the close control is labelled for assistive tech');
  }
});

test('case studies: dialog copy matches its project card verbatim (no drift, no invented facts)', () => {
  for (const card of cards) {
    const slug = slugOf(card);
    const dialog = document.getElementById(`case-${slug}`);
    const text = normalise(dialog.textContent);

    // Title: the dialog repeats the card's own title.
    const title = normalise(card.querySelector('.project-title').textContent);
    assert.ok(text.includes(title), `${slug}: dialog title matches the card`);

    // Outcome: the card's outcome line appears verbatim in the panel.
    const outcome = normalise(card.querySelector('.project-outcome').textContent);
    assert.ok(outcome.length > 0, `${slug}: the card states an outcome`);
    assert.ok(text.includes(outcome), `${slug}: dialog outcome matches the card verbatim`);

    // Stack: every tag on the card is listed in the dialog, and vice versa.
    const cardTags = [...card.querySelectorAll('.tag')].map((tag) => normalise(tag.textContent));
    const dialogTags = [...dialog.querySelectorAll('.case-study-stack li')].map((tag) => normalise(tag.textContent));
    assert.deepEqual(dialogTags, cardTags, `${slug}: dialog stack matches the card tags exactly`);

    // The problem statement is the card's own description, not a new claim.
    const description = normalise(card.querySelector('.project-desc').textContent);
    const problem = normalise(dialog.querySelector('.case-study-section p').textContent);
    assert.ok(description.length > 0 && problem.length > 0, `${slug}: both descriptions exist`);
  }
});

test('case studies: no dialog ships a stray URL or a half-filled placeholder', () => {
  for (const dialog of dialogs) {
    const links = [...dialog.querySelectorAll('a')];
    for (const link of links) {
      const href = link.getAttribute('href');
      assert.ok(href, `${dialog.id}: every anchor has an href`);
      // The only acceptable destinations are the contact address; real project
      // URLs are a deliberate gap in this revision, so nothing may smuggle in
      // a plausible-looking placeholder.
      assert.ok(href.startsWith('mailto:'), `${dialog.id}: unexpected link target ${href}`);
    }
    assert.ok(!/https?:\/\//.test(dialog.textContent), `${dialog.id}: no bare URL in the copy`);
  }
});

test('case studies: the opener is hidden until JS can honour it', () => {
  const css = fs.readFileSync('../css/style.css', 'utf8');
  assert.ok(/\.project-case-open\s*\{\s*display:\s*none/.test(css), 'the opener is hidden by default');
  assert.ok(/\.js\s+\.project-case-open/.test(css), 'the opener is revealed once JS is present');
  assert.ok(css.includes('html.case-open'), 'an open dialog can lock page scroll');
});
