/**
 * Markdown-it plugin that turns bare DOIs into clickable doi.org
 * links (#473).
 *
 * `linkify` already auto-links DOI URLs (`https://doi.org/...`).
 * What it misses is the bare form a researcher actually types:
 *
 *   See 10.1145/3677999.3678002 for the data.
 *
 * The plugin runs as a `core` rule that walks every text token,
 * splices DOI matches into separate `text` + `link_open` + `text` +
 * `link_close` token triples, and lets the standard renderer take
 * over. No custom render rule; the resulting links use the default
 * `<a href=…>` shape so external-link interception (Preview.svelte)
 * works unchanged.
 */

import type { MarkdownIt } from 'markdown-it';
import type { Token } from 'markdown-it';
import type { StateCore } from 'markdown-it';

/**
 * DOI form per Crossref: `10.NNNN/...` where NNNN is a 4–9 digit
 * registry, the suffix allows the characters Crossref actually uses
 * in the wild. Trailing punctuation we strip after matching so a DOI
 * at end of sentence doesn't eat the period.
 *
 * The `\b` boundary keeps `2.10.4321/foo` from matching mid-token —
 * a DOI must start at a word boundary.
 */
const DOI_RE = /\b10\.\d{4,9}\/[-._;/:a-zA-Z0-9]+/g;
/** Trailing punctuation we never want as part of the DOI itself.
 *  Includes `.` so a sentence-final DOI doesn't gain a stray period. */
const DOI_TRAILING_PUNCT = /[.,;:!?)]+$/;

export function installDoiAutolink(md: MarkdownIt): void {
  md.core.ruler.after('linkify', 'doi_autolink', (state) => {
    for (const blockToken of state.tokens) {
      if (blockToken.type !== 'inline' || !blockToken.children) continue;
      const next: Token[] = [];
      // Skip text inside an existing `<a>` (linkify-produced or
      // hand-authored) — re-linking the visible URL would nest
      // anchors and steal the click target.
      let linkDepth = 0;
      for (const child of blockToken.children) {
        if (child.type === 'link_open') linkDepth++;
        if (child.type === 'link_close') { linkDepth = Math.max(0, linkDepth - 1); next.push(child); continue; }
        if (child.type !== 'text' || linkDepth > 0) {
          next.push(child);
          continue;
        }
        const replaced = splitTextOnDoi(state, child, blockToken.level);
        for (const t of replaced) next.push(t);
      }
      blockToken.children = next;
    }
  });
}

function splitTextOnDoi(
  state: StateCore,
  textToken: Token,
  level: number,
): Token[] {
  const content = textToken.content;
  DOI_RE.lastIndex = 0;
  const out: Token[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = DOI_RE.exec(content)) !== null) {
    // Trim trailing punctuation that doesn't belong to the DOI.
    let raw = match[0];
    const punct = raw.match(DOI_TRAILING_PUNCT);
    if (punct) raw = raw.slice(0, -punct[0].length);
    if (raw.length === 0) continue;

    // Pre-DOI text.
    if (match.index > cursor) {
      const pre = new state.Token('text', '', 0);
      pre.content = content.slice(cursor, match.index);
      pre.level = level;
      out.push(pre);
    }

    const open = new state.Token('link_open', 'a', 1);
    open.attrSet('href', `https://doi.org/${raw}`);
    open.markup = 'doi';
    open.level = level;
    out.push(open);

    const inner = new state.Token('text', '', 0);
    inner.content = raw;
    inner.level = level + 1;
    out.push(inner);

    const close = new state.Token('link_close', 'a', -1);
    close.markup = 'doi';
    close.level = level;
    out.push(close);

    // Advance past the matched DOI; the stripped trailing punctuation
    // becomes prose in the next iteration's pre-DOI slice.
    cursor = match.index + raw.length;
  }
  // Tail.
  if (cursor === 0) return [textToken];
  if (cursor < content.length) {
    const tail = new state.Token('text', '', 0);
    tail.content = content.slice(cursor);
    tail.level = level;
    out.push(tail);
  }
  return out;
}
