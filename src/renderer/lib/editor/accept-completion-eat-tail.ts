import type { Command, KeyBinding } from '@codemirror/view';
import {
  acceptCompletion,
  closeCompletion,
  completionKeymap,
  selectedCompletion,
} from '@codemirror/autocomplete';

/**
 * Enter-accept that also eats the half-typed word tail after the cursor (#206).
 *
 * Tab and the default Enter both accept the active completion by replacing
 * only what's between the completion's `from` and the cursor — anything the
 * user had typed *after* the cursor stays put. So Enter-accepting `SELECT`
 * from the middle of `SEL|stuff` leaves `SELECTstuff`. This command instead
 * lands you on `SELECT`.
 *
 * It eats only the contiguous run of *word* characters (`\w`) after the
 * cursor, not all non-whitespace. That's the difference that makes it safe in
 * the markdown editor too: editing the middle of `[[No|te]]` and accepting a
 * note stops the eat at the `]`, yielding `[[Notebook]]` rather than swallowing
 * the closing brackets. Same for `#fo|o, rest` — the `,` halts the eat.
 *
 * Returns false when no completion is selected so Enter falls through to its
 * normal job (newline, list continuation, …). Pair with
 * {@link completionKeymapNoEnter} and `autocompletion({ defaultKeymap: false })`
 * so the built-in Enter binding doesn't win the precedence tie — at any
 * precedence the built-in beat a sibling Enter entry, which is why earlier
 * attempts in #206's PR never fired.
 */
export const acceptCompletionEatTail: Command = (view) => {
  if (!selectedCompletion(view.state)) return false;
  if (!acceptCompletion(view)) return false;

  // acceptCompletion dispatches synchronously, so `view.state` here is the
  // post-accept doc with the cursor sitting just before any leftover tail.
  const { state } = view;
  const changes: { from: number; to: number }[] = [];
  for (const range of state.selection.ranges) {
    const head = range.head;
    const line = state.doc.lineAt(head);
    const end = line.from + wordTailEnd(line.text, head - line.from);
    if (end > head) changes.push({ from: head, to: end });
  }
  if (changes.length > 0) {
    view.dispatch({ changes, scrollIntoView: true });
  }
  // Deleting the tail can re-trigger activate-on-typing; the user just
  // committed a choice, so keep the popup shut.
  closeCompletion(view);
  return true;
};

/**
 * Index just past the contiguous run of word characters (`\w`) starting at
 * `from` in `text`. Stops at the first non-word char (whitespace, `]`, `)`,
 * `,`, `.`, …) or end of string — that boundary is what keeps the eat from
 * swallowing `]]` in `[[link]]` or the `,` after a `#tag`. Exported for tests.
 */
export function wordTailEnd(text: string, from: number): number {
  let to = from;
  while (to < text.length && /\w/.test(text[to])) to++;
  return to;
}

/**
 * The default completion keymap with its Enter binding removed, so a custom
 * Enter command (e.g. {@link acceptCompletionEatTail}) can own that key.
 * Install this alongside `autocompletion({ defaultKeymap: false })` to keep
 * arrow-navigation / Escape-to-close while replacing only Enter.
 */
export const completionKeymapNoEnter: readonly KeyBinding[] =
  completionKeymap.filter((b) => b.key !== 'Enter');
