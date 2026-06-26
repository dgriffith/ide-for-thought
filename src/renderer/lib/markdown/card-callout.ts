/**
 * Flashcard preview polish (#850 follow-up).
 *
 * A `[!card]` callout renders as front · `<hr>` · back. For a study-friendly
 * preview we hide the back (the answer) behind a collapsed "Show answer"
 * disclosure so the prompt stands alone until you choose to reveal it — the way
 * you'd actually use a flashcard.
 *
 * Done as a post-render DOM pass (like the mermaid / vega hydrators) rather than
 * in markdown-it, so we can cleanly split the rendered content at the divider
 * without fighting tokenization. The preview HTML is regenerated on every render,
 * so this re-runs over fresh DOM; the `data-card-hydrated` guard keeps a repeated
 * `$effect` from double-wrapping the same render.
 */

/**
 * For each `[!card]` callout, move everything after its `---` divider into a
 * collapsed `<details>`. Cards without a divider (malformed / front-only) are
 * left untouched.
 */
export function hydrateCardCallouts(root: HTMLElement): void {
  const cards = root.querySelectorAll<HTMLElement>('.callout-card .callout-content:not([data-card-hydrated])');
  for (const content of cards) {
    content.setAttribute('data-card-hydrated', '1');
    const hr = content.querySelector(':scope > hr');
    if (!hr) continue;

    // Gather every node after the divider — the back of the card.
    const back: ChildNode[] = [];
    for (let node = hr.nextSibling; node; node = node.nextSibling) back.push(node);
    if (back.length === 0) continue;

    const details = document.createElement('details');
    details.className = 'card-answer';
    const summary = document.createElement('summary');
    summary.className = 'card-answer-summary';
    summary.textContent = 'Show answer';
    // Keep the label honest as the disclosure opens/closes (real text, not a CSS
    // pseudo, so screen readers announce it).
    details.addEventListener('toggle', () => {
      summary.textContent = details.open ? 'Hide answer' : 'Show answer';
    });
    const body = document.createElement('div');
    body.className = 'card-answer-body';
    for (const node of back) body.appendChild(node);
    details.append(summary, body);

    // The disclosure replaces the divider — its summary is the visual seam.
    hr.replaceWith(details);
  }
}
