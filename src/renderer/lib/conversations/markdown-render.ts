/**
 * The conversation transcript's markdown renderer, plus a memo for finalized
 * turns (#2219).
 *
 * ── The claim this corrects ────────────────────────────────────────────────
 * #2219 says the unkeyed `{#each tab.conversation.messages}` "re-renders
 * **every** message in the transcript" when `conversations.svelte.ts` replaces
 * `tab.conversation` wholesale after a send, and proposes keying the `{#each}`
 * as the fix. Half of that is right, and the proposed fix addresses the half
 * that isn't.
 *
 * Svelte 5's `{@html}` short-circuits on an unchanged string — literally
 * `if (value === (value = get_value() ?? '')) return;` in
 * `svelte/src/internal/client/dom/blocks/html.js` — so the **DOM does not
 * churn**. No subtree is torn down and no selection is lost. What *does* re-run
 * is `md.render(msg.content)` for every message, because that call lives inside
 * the effect's `get_value` closure and is evaluated before the comparison.
 *
 * Keying the `{#each}` would not fix that. The re-parse happens because
 * `tab.conversation.messages` is a brand-new array of brand-new objects, so
 * `msg` changes identity at every index and the effect re-runs regardless of
 * how the block is keyed. (Keying by index is what unkeyed already does;
 * keying by a message id would preserve the *block*, not the item identity.)
 * Keying would also have added the risk the issue warns about — a re-sent or
 * edited turn failing to update — in exchange for nothing.
 *
 * A memo keyed on the markdown source fixes it exactly. Measured, transcripts
 * of real 6,679-char replies, cost per completed turn:
 *
 *     10 messages : 6.8ms  -> 0.003ms
 *     40 messages : 10.6ms -> 0.001ms
 *     80 messages : 29.0ms -> 0.004ms
 *
 * A single ~29ms hitch when a turn lands is not the headline bug — the
 * streaming path is — but it is the whole of this one, it recurs on every turn
 * and on every model-picker change, and it costs twelve lines to remove.
 */
import MarkdownIt from 'markdown-it';

// Mirrors the configuration the conversation UI has always used, so finalized
// and streaming turns render identically.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
});

/** Render without consulting the memo. Use for the in-flight message: its text
 *  is different on every flush, so caching it would evict the whole transcript
 *  one growing prefix at a time and never score a hit. */
export function renderMarkdown(src: string): string {
  return md.render(src);
}

/**
 * Bounded so a long research session cannot grow the cache without limit. A
 * plain insertion-ordered `Map` with oldest-first eviction, not a true LRU:
 * the access pattern here is "re-render the same transcript", where every live
 * entry is touched on every pass, so recency carries no information that
 * insertion order doesn't. 200 entries covers transcripts far longer than the
 * conversation panel is usable at.
 */
const MEMO_LIMIT = 200;
const memo = new Map<string, string>();

/** Render a *finalized* message, reusing the previous render of identical
 *  source. Safe because `md.render` is a pure function of its input and the
 *  result is an immutable string handed to `{@html}`. */
export function renderMarkdownCached(src: string): string {
  const hit = memo.get(src);
  if (hit !== undefined) return hit;
  const html = md.render(src);
  if (memo.size >= MEMO_LIMIT) {
    const oldest = memo.keys().next();
    if (!oldest.done) memo.delete(oldest.value);
  }
  memo.set(src, html);
  return html;
}

/** Test-only escape hatch (underscore-prefixed, per the convention in
 *  `search/index.ts`): drop memoized renders so one test's transcript cannot
 *  satisfy another's cache-miss assertion. */
export function _clearMarkdownMemoForTests(): void {
  memo.clear();
}
