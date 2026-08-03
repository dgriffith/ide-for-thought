/**
 * Markdown-it plugin: `==text==` and `==color:text==` highlights (#468).
 *
 * Renders as `<mark class="hl">…</mark>` (default) or
 * `<mark class="hl hl-{color}">…</mark>` for a recognised palette color
 * (yellow, green, blue, pink, orange). Unrecognised prefixes fall
 * through as part of the body, so `==Pythagorean: a²+b²==` highlights
 * the whole thing rather than guessing at a color.
 *
 * Tokenisation is recursive: the body re-enters the inline parser so
 * `==**bold**==` and `==[[wiki-link]]==` work as expected. We register
 * before `emphasis` so `**==X==**` resolves outermost-emphasis ↦
 * inner-highlight without delimiter races.
 *
 * A highlight may span soft line breaks within a paragraph, the same
 * way `**strong**` and `*emphasis*` do; a blank line ends the paragraph
 * (and the block), so a highlight never reaches across it.
 *
 * Rejects, following Pandoc convention:
 *   - `===` runs (three or more equals — heading-rule territory)
 *   - empty bodies
 *   - whitespace immediately after the opening `==` or before the
 *     closing `==` (matches strong/em — keeps `== test ==` in prose
 *     from accidentally highlighting)
 */

import type { MarkdownIt } from 'markdown-it';
import type { StateInline } from 'markdown-it';

export const HIGHLIGHT_PALETTE = ['yellow', 'green', 'blue', 'pink', 'orange'] as const;
export type HighlightColor = typeof HIGHLIGHT_PALETTE[number];
const PALETTE_SET = new Set<string>(HIGHLIGHT_PALETTE);

const COLOR_PREFIX_RE = /^([a-z]+):/;

/**
 * True when the line starting at `pos` is blank (only spaces/tabs/CR
 * before the next newline or end-of-text). A blank line ends a markdown
 * paragraph, so `scanHighlights` treats it as a hard stop — the flat-text
 * scanner's stand-in for the preview plugin's per-block `posMax` bound.
 */
function isBlankLineAt(text: string, pos: number): boolean {
  let k = pos;
  while (k < text.length) {
    const c = text.charCodeAt(k);
    if (c === 0x0a) return true; // reached the next newline with only blanks
    if (c !== 0x20 && c !== 0x09 && c !== 0x0d) return false;
    k++;
  }
  return true; // end of text — nothing more to highlight into
}

export interface HighlightMatch {
  /** Offset of the opening `==` in the input. */
  from: number;
  /** Offset just past the closing `==` in the input. */
  to: number;
  /** Palette color, or null for the uncolored default. */
  color: HighlightColor | null;
}

/**
 * Scan flat text for `==…==` highlights and return their absolute
 * offsets + color. Used by the CodeMirror source-mode decoration
 * (#468) so the editor and the preview agree about what counts as a
 * highlight. The plugin uses the parser-state form; this helper mirrors
 * the same rejection rules:
 *
 *   - `===` runs are not delimiters (forward OR backward)
 *   - empty bodies are not delimiters
 *   - a single newline is spanned; a blank line ends the paragraph and
 *     stops the match (the flat-text stand-in for the plugin's per-block bound)
 *   - whitespace adjacent to either delimiter rejects (matches strong/em)
 *
 * `offset` is added to each result so the caller can pass a slice of
 * the editor document and recover absolute positions.
 */
export function scanHighlights(text: string, offset = 0): HighlightMatch[] {
  const out: HighlightMatch[] = [];
  let i = 0;
  while (i < text.length - 1) {
    if (text.charCodeAt(i) !== 0x3d || text.charCodeAt(i + 1) !== 0x3d) { i++; continue; }
    if (text.charCodeAt(i + 2) === 0x3d) { i++; continue; }
    if (i > 0 && text.charCodeAt(i - 1) === 0x3d) { i++; continue; }
    const afterOpen = text.charCodeAt(i + 2);
    if (afterOpen === 0x20 || afterOpen === 0x09 || afterOpen === 0x0a) { i++; continue; }

    // Scan for the closing `==`. A single newline is fine — the highlight
    // spans it, matching the preview plugin — but a blank line ends the
    // paragraph, and the preview's inline scan can't reach past a block
    // boundary, so we stop there too to keep the two surfaces in sync.
    let j = i + 2;
    let closing = -1;
    while (j < text.length - 1) {
      const c = text.charCodeAt(j);
      if (c === 0x0a && isBlankLineAt(text, j + 1)) break;
      if (
        c === 0x3d &&
        text.charCodeAt(j + 1) === 0x3d &&
        text.charCodeAt(j + 2) !== 0x3d
      ) {
        closing = j;
        break;
      }
      j++;
    }
    if (closing === -1) { i++; continue; }
    if (closing === i + 2) { i++; continue; }
    const beforeClose = text.charCodeAt(closing - 1);
    if (beforeClose === 0x20 || beforeClose === 0x09) { i++; continue; }

    const content = text.slice(i + 2, closing);
    const colorMatch = COLOR_PREFIX_RE.exec(content);
    let color: HighlightColor | null = null;
    if (colorMatch && PALETTE_SET.has(colorMatch[1]!)) {
      // Match the plugin's "color prefix with empty body" guard
      // (`==yellow:==` falls back to uncolored).
      if (colorMatch[0].length < content.length) {
        color = colorMatch[1] as HighlightColor;
      }
    }
    out.push({ from: offset + i, to: offset + closing + 2, color });
    i = closing + 2;
  }
  return out;
}

export function installHighlight(md: MarkdownIt): void {
  md.inline.ruler.before('emphasis', 'highlight', highlightInline);
  // No render override: markdown-it's default emits `<mark>…</mark>`
  // (driven by the tokens' `tag = 'mark'`) and flows every attrSet
  // attribute through automatically — including `data-hl-color`.
}

function highlightInline(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x3d /* = */) return false;
  if (state.src.charCodeAt(state.pos + 1) !== 0x3d) return false;
  // Three or more `=` in a row aren't a highlight delimiter — most
  // commonly seen as ASCII rules or table-of-contents formatting. We
  // reject both forward (`===` starting here) and backward (the `==`
  // we're at is itself the tail of a longer run, e.g. mid-`===`).
  if (state.src.charCodeAt(state.pos + 2) === 0x3d) return false;
  if (state.pos > 0 && state.src.charCodeAt(state.pos - 1) === 0x3d) return false;

  const bodyStart = state.pos + 2;
  // Whitespace immediately after opening — matches the strong/em rule
  // ("== text ==" is prose, not a highlight).
  const afterOpen = state.src.charCodeAt(bodyStart);
  if (afterOpen === 0x20 || afterOpen === 0x09 || afterOpen === 0x0a) return false;

  // Scan forward for the closing `==` that isn't itself part of `===`.
  // Soft newlines inside the body are allowed — a highlight spans line
  // breaks the same way emphasis does. `state.posMax` already bounds the
  // scan to this paragraph, so a blank line (which ends the block) is an
  // automatic stop; we never reach across a paragraph break.
  let scan = bodyStart;
  let closingPos = -1;
  while (scan < state.posMax - 1) {
    const c = state.src.charCodeAt(scan);
    if (
      c === 0x3d &&
      state.src.charCodeAt(scan + 1) === 0x3d &&
      state.src.charCodeAt(scan + 2) !== 0x3d
    ) {
      closingPos = scan;
      break;
    }
    scan++;
  }
  if (closingPos === -1) return false;
  if (closingPos === bodyStart) return false;
  // Whitespace immediately before the closing — same rule.
  const beforeClose = state.src.charCodeAt(closingPos - 1);
  if (beforeClose === 0x20 || beforeClose === 0x09) return false;

  // Parse optional color prefix. Only a known palette entry counts;
  // anything else stays in the body (`==Pythagorean: a²+b²==`).
  const content = state.src.slice(bodyStart, closingPos);
  const colorMatch = COLOR_PREFIX_RE.exec(content);
  let color: HighlightColor | null = null;
  let innerStart = bodyStart;
  if (colorMatch && PALETTE_SET.has(colorMatch[1]!)) {
    color = colorMatch[1] as HighlightColor;
    innerStart = bodyStart + colorMatch[0].length;
  }
  // After stripping a color prefix the body might be empty
  // (`==yellow:==`) — that's not a real highlight; fall back to
  // treating the whole content as the body so the user can see what
  // they wrote.
  if (innerStart >= closingPos) {
    color = null;
    innerStart = bodyStart;
  }

  if (silent) {
    state.pos = closingPos + 2;
    return true;
  }

  // Push the open token, then recursively tokenise the body so other
  // inline rules (emphasis, wiki-links, code spans) still run inside.
  const open = state.push('highlight_open', 'mark', 1);
  open.markup = '==';
  open.attrSet('class', color ? `hl hl-${color}` : 'hl');
  if (color) open.attrSet('data-hl-color', color);

  const savedPos = state.pos;
  const savedMax = state.posMax;
  state.pos = innerStart;
  state.posMax = closingPos;
  state.md.inline.tokenize(state);
  state.pos = savedPos;
  state.posMax = savedMax;

  const close = state.push('highlight_close', 'mark', -1);
  close.markup = '==';

  state.pos = closingPos + 2;
  return true;
}
