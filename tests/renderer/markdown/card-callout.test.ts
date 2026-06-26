/**
 * @vitest-environment happy-dom
 *
 * Flashcard preview polish (#850 follow-up): the post-render pass that hides a
 * card's answer (everything after the `---` divider) behind a collapsed
 * "Show answer" disclosure so the prompt stands alone until revealed.
 */

import { describe, it, expect } from 'vitest';
import { hydrateCardCallouts } from '../../../src/renderer/lib/markdown/card-callout';

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
