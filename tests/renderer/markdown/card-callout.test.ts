/**
 * @vitest-environment happy-dom
 *
 * Flashcard preview polish (#850 follow-up): the post-render pass that hides a
 * card's answer (everything after the `---` divider) behind a collapsed
 * "Show answer" disclosure so the prompt stands alone until revealed.
 */

import { describe, it, expect } from 'vitest';
import {
  hydrateCardCallouts,
  _clearCardDisclosureForTests,
  _cardDisclosureSizeForTests,
} from '../../../src/renderer/lib/markdown/card-callout';

/** Build the DOM a `[!card]` callout renders to: title + content with an <hr>. */
function cardEl(innerContent: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML =
    `<div class="callout callout-card" data-callout="card">` +
    `<div class="callout-title"><span class="callout-title-text">Card</span></div>` +
    `<div class="callout-content">${innerContent}</div></div>`;
  return root;
}

describe('hydrateCardCallouts', () => {
  it('moves everything after the divider into a collapsed <details>', () => {
    const root = cardEl('<p>Front</p><hr><p>Back</p>');
    hydrateCardCallouts(root);

    const details = root.querySelector('details.card-answer');
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false); // collapsed by default
    expect(root.querySelector('hr')).toBeNull();              // divider replaced
    expect(details!.querySelector('.card-answer-body')!.textContent).toContain('Back');
    // The front stays outside the disclosure.
    const front = root.querySelector('.callout-content > p');
    expect(front!.textContent).toBe('Front');
  });

  it('summary label tracks the open/closed state', () => {
    const root = cardEl('<p>Front</p><hr><p>Back</p>');
    hydrateCardCallouts(root);
    const details = root.querySelector('details.card-answer') as HTMLDetailsElement;
    const summary = details.querySelector('summary')!;
    expect(summary.textContent).toBe('Show answer');

    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(summary.textContent).toBe('Hide answer');
  });

  it('leaves a card with no divider untouched', () => {
    const root = cardEl('<p>Front only</p>');
    hydrateCardCallouts(root);
    expect(root.querySelector('details')).toBeNull();
    expect(root.querySelector('.callout-content')!.textContent).toBe('Front only');
  });

  it('is idempotent — a second pass does not double-wrap', () => {
    const root = cardEl('<p>Front</p><hr><p>Back</p>');
    hydrateCardCallouts(root);
    hydrateCardCallouts(root);
    expect(root.querySelectorAll('details.card-answer').length).toBe(1);
  });

  it('ignores non-card callouts', () => {
    const root = document.createElement('div');
    root.innerHTML =
      `<div class="callout callout-note"><div class="callout-content">` +
      `<p>A</p><hr><p>B</p></div></div>`;
    hydrateCardCallouts(root);
    expect(root.querySelector('details')).toBeNull();
    expect(root.querySelector('hr')).not.toBeNull();
  });
});


/**
 * A revealed answer survives the render tick (#2329).
 *
 * `Preview.svelte` renders through `{@html rendered}`, which replaces the whole
 * subtree every ~120ms while you type. The disclosure lived only on the
 * `<details>` element, so revealing an answer and then typing re-collapsed it —
 * and `data-card-hydrated` could not help, because it is written on an element
 * the next tick destroys.
 *
 * Every test below re-renders the note's HTML into the SAME root before
 * hydrating again, which is what the swap actually does. Re-using the existing
 * DOM would exercise the attribute guard that already worked, not the case it
 * fails in.
 */
describe('disclosure state across a render tick (#2329)', () => {
  /** One preview root whose children are replaced per tick, as Svelte does. */
  function preview(): HTMLElement {
    const root = document.createElement('div');
    document.body.appendChild(root);
    return root;
  }

  const CARD = (front: string, back: string) =>
    `<div class="callout callout-card" data-callout="card">`
    + `<div class="callout-title"><span class="callout-title-text">Card</span></div>`
    + `<div class="callout-content"><p>${front}</p><hr><p>${back}</p></div></div>`;

  /** Simulate one `{@html}` swap + post-render hydration pass. */
  function tick(root: HTMLElement, html: string, notePath = 'notes/a.md'): void {
    root.innerHTML = html;
    hydrateCardCallouts(root, notePath);
  }

  const detailsIn = (root: HTMLElement, n = 0) =>
    root.querySelectorAll<HTMLDetailsElement>('details.card-answer')[n]!;

  it('stays open across a re-render', () => {
    const root = preview();
    _clearCardDisclosureForTests(root);
    tick(root, CARD('Q', 'A'));
    expect(detailsIn(root).open).toBe(false);

    detailsIn(root).open = true;               // the reader clicks "Show answer"
    tick(root, CARD('Q', 'A'));                // and then types

    expect(detailsIn(root).open, 'the answer re-collapsed itself').toBe(true);
  });

  it('the summary label comes back with it', () => {
    const root = preview();
    _clearCardDisclosureForTests(root);
    tick(root, CARD('Q', 'A'));
    detailsIn(root).open = true;
    tick(root, CARD('Q', 'A'));
    expect(detailsIn(root).querySelector('.card-answer-summary')!.textContent).toBe('Hide answer');
  });

  it('survives an edit to the card\'s own text', () => {
    // The case keying on source text would get wrong, and the reason this
    // hydrator keys on ordinal instead of reusing #2328's `blockKey`.
    const root = preview();
    _clearCardDisclosureForTests(root);
    tick(root, CARD('Q', 'A'));
    detailsIn(root).open = true;
    tick(root, CARD('Q, revised', 'A'));
    expect(detailsIn(root).open, 'editing the card collapsed its own answer').toBe(true);
  });

  it('a closed card stays closed', () => {
    const root = preview();
    _clearCardDisclosureForTests(root);
    tick(root, CARD('Q', 'A'));
    tick(root, CARD('Q', 'A'));
    expect(detailsIn(root).open).toBe(false);
  });

  it('re-hiding an answer sticks', () => {
    const root = preview();
    _clearCardDisclosureForTests(root);
    tick(root, CARD('Q', 'A'));
    detailsIn(root).open = true;
    tick(root, CARD('Q', 'A'));
    detailsIn(root).open = false;              // the reader hides it again
    tick(root, CARD('Q', 'A'));
    expect(detailsIn(root).open, 'a re-hidden answer reopened itself').toBe(false);
  });

  it('tracks each card independently', () => {
    const root = preview();
    _clearCardDisclosureForTests(root);
    const two = CARD('Q1', 'A1') + CARD('Q2', 'A2');
    tick(root, two);
    detailsIn(root, 1).open = true;            // only the second
    tick(root, two);
    expect(detailsIn(root, 0).open, 'the first card opened on its own').toBe(false);
    expect(detailsIn(root, 1).open).toBe(true);
  });

  it('two cards with identical text do not share state', () => {
    // Ordinal keying handles this for free; source keying would need an
    // occurrence index to avoid it.
    const root = preview();
    _clearCardDisclosureForTests(root);
    const same = CARD('Q', 'A') + CARD('Q', 'A');
    tick(root, same);
    detailsIn(root, 0).open = true;
    tick(root, same);
    expect(detailsIn(root, 0).open).toBe(true);
    expect(detailsIn(root, 1).open, 'an identical card inherited the first one\'s state').toBe(false);
  });

  it('a different note starts hidden, and coming back stays hidden', () => {
    // Deliberate: a flashcard is a prompt, and should still be a prompt the
    // next time the note is opened. `notePath` is in the key and off-screen
    // entries are pruned, so this is not accidental.
    const root = preview();
    _clearCardDisclosureForTests(root);
    tick(root, CARD('Q', 'A'), 'notes/a.md');
    detailsIn(root).open = true;

    tick(root, CARD('Other', 'Answer'), 'notes/b.md');
    expect(detailsIn(root).open, 'another note inherited this one\'s state').toBe(false);

    tick(root, CARD('Q', 'A'), 'notes/a.md');
    expect(detailsIn(root).open).toBe(false);
  });

  it('forty edits to one card reuse a single entry', () => {
    // The design choice, stated as a size. A content-derived key — #2328's
    // `blockKey` — would leave forty entries here, one per revision, because
    // every keystroke changes the source. Ordinal keying reuses one.
    //
    // Note what this does NOT show: pruning. The key never varies across
    // these forty ticks, so the map holds one entry with or without it. The
    // deletion case below is what covers the prune.
    const root = preview();
    _clearCardDisclosureForTests(root);
    for (let i = 0; i < 40; i++) {
      tick(root, CARD(`Q${i}`, `A${i}`));
      detailsIn(root).open = true;
    }
    expect(
      _cardDisclosureSizeForTests(root),
      `40 revisions left ${_cardDisclosureSizeForTests(root)} entries resident`,
    ).toBe(1);
    expect(detailsIn(root).open, 'the card lost its state along the way').toBe(true);
  });

  it('drops an entry when its card is deleted from the note', () => {
    const root = preview();
    _clearCardDisclosureForTests(root);
    tick(root, CARD('Q1', 'A1') + CARD('Q2', 'A2'));
    detailsIn(root, 0).open = true;
    detailsIn(root, 1).open = true;
    expect(_cardDisclosureSizeForTests(root)).toBe(2);

    tick(root, CARD('Q1', 'A1'));              // second card deleted
    expect(_cardDisclosureSizeForTests(root), 'the deleted card kept an entry').toBe(1);
  });

  it('hydrates cards injected by a later pass without renumbering', () => {
    // `hydrate.ts` calls this again after transclusions inject embedded
    // content. Ordinals are taken over EVERY card in the root, hydrated or
    // not, so the second pass agrees with the first about which card is which.
    const root = preview();
    _clearCardDisclosureForTests(root);
    tick(root, CARD('Host', 'HostAnswer'));
    detailsIn(root).open = true;

    // Re-render, then hydrate, then inject an embedded card and hydrate again.
    root.innerHTML = CARD('Host', 'HostAnswer');
    hydrateCardCallouts(root, 'notes/a.md');
    root.insertAdjacentHTML('beforeend', CARD('Embedded', 'EmbeddedAnswer'));
    hydrateCardCallouts(root, 'notes/a.md');

    expect(root.querySelectorAll('details.card-answer')).toHaveLength(2);
    expect(detailsIn(root, 0).open, 'the host card lost its state to the second pass').toBe(true);
    expect(detailsIn(root, 1).open).toBe(false);
  });
});
