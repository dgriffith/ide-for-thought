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
 * Which cards the reader has revealed, per preview root (#2329).
 *
 * The disclosure lived only on a `<details>` element, and `{@html rendered}`
 * replaces the whole subtree every ~120ms render tick — so a revealed answer
 * re-collapsed itself on the next keystroke. `data-card-hydrated` could not
 * help: it is written on an element the next tick destroys, the same shape as
 * #2210 §3c, with state loss rather than slowness as the symptom.
 *
 * The flashcard case makes it sharper than it sounds. Revealing an answer is
 * the *point* of the control, and what a reader does next — in this app —
 * frequently involves typing.
 *
 * ── Keyed by position, deliberately unlike #2328 ────────────────────────────
 * `hydrated-block-cache.ts` keys a block by its SOURCE TEXT plus an occurrence
 * index, because it reuses rendered nodes and a content change must invalidate
 * them or the reader sees stale output. Nothing is reused here — hydration is
 * 0.0ms for one card and 0.1ms for twenty (measured in #2328, which is why
 * that PR deliberately left this hydrator alone) — so the only thing carried
 * across a tick is a boolean, and a content change need not invalidate it at
 * all.
 *
 * Keying by source would therefore be actively worse: editing a card's text
 * would collapse its own answer, which is exactly the "while you type"
 * complaint this fixes. Ordinal position survives every text edit.
 *
 * Nor could this hydrator adopt #2328's wrapper: `.callout-content > hr`,
 * `> :first-child` and `> :last-child` in `global.css` are direct-child
 * selectors, and a wrapper — even `display: contents`, which removes the box
 * but not the element — stops all three matching. The divider styling would
 * silently disappear.
 *
 * ── Two passes, one numbering ───────────────────────────────────────────────
 * `hydrateCardCallouts` is called twice per tick: once over the host note and
 * again by `hydrate.ts`'s post-injection battery, after transclusions have
 * added embedded content. Ordinals are therefore taken over EVERY
 * `.callout-card` in the root, hydrated or not, so both passes derive the same
 * key for the same card rather than each restarting at zero.
 *
 * ── Resetting on a note switch is correct, not a gap ────────────────────────
 * `notePath` is in the key and entries not on screen are pruned, so returning
 * to a note shows its answers hidden again. For a flashcard that is the
 * desired behaviour: the card is a prompt, and it should still be a prompt the
 * next time you open the note.
 */
const revealed = new WeakMap<HTMLElement, Map<string, boolean>>();

/** Test seam — the state is per-root and otherwise unreachable. */
export function _clearCardDisclosureForTests(root: HTMLElement): void {
  revealed.delete(root);
}

/**
 * Live entry count. Exists because "the map is pruned" is otherwise an
 * unobservable claim: removing the prune breaks only the note-switch test,
 * which is about correctness, and leaves boundedness asserted by nobody.
 */
export function _cardDisclosureSizeForTests(root: HTMLElement): number {
  return revealed.get(root)?.size ?? 0;
}

/**
 * For each `[!card]` callout, move everything after its `---` divider into a
 * collapsed `<details>`. Cards without a divider (malformed / front-only) are
 * left untouched.
 */
export function hydrateCardCallouts(root: HTMLElement, notePath: string | null = null): void {
  let states = revealed.get(root);
  if (!states) {
    states = new Map<string, boolean>();
    revealed.set(root, states);
  }

  const allCards = Array.from(root.querySelectorAll<HTMLElement>('.callout-card'));
  const keyFor = (ordinal: number) => `${notePath ?? ''}\u0000${ordinal}`;

  // Prune BEFORE reading: a note switch reuses low ordinals, so the previous
  // note's entry for the same position has to be gone before this note's card
  // asks whether it was open.
  const live = new Set(allCards.map((_, i) => keyFor(i)));
  for (const k of [...states.keys()]) if (!live.has(k)) states.delete(k);

  for (const [ordinal, card] of allCards.entries()) {
    const content = card.querySelector<HTMLElement>('.callout-content');
    if (!content || content.hasAttribute('data-card-hydrated')) continue;
    const key = keyFor(ordinal);
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
      states.set(key, details.open);
    });
    const body = document.createElement('div');
    body.className = 'card-answer-body';
    for (const node of back) body.appendChild(node);
    details.append(summary, body);

    // The disclosure replaces the divider — its summary is the visual seam.
    hr.replaceWith(details);

    // Restore AFTER the listener is attached, so the label follows the state
    // through the same path a click takes rather than needing its own copy of
    // the wording. Assigning `open` fires `toggle`.
    if (states.get(key) === true) details.open = true;
  }
}
