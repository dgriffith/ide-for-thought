/**
 * Block-link helpers for the editor's "Copy Block Link" right-click action.
 *
 * Given a cursor position in the document, figure out which paragraph is
 * being targeted and decide whether to reuse an existing `^block-id` or
 * insert a new one. Pure-string implementation so it's testable without
 * spinning up a CodeMirror state.
 */

const BLOCK_ID_END_RE = /\s\^([\w-]+)\s*$/;

export interface BlockLinkPlan {
  /** The id to use in the canonical `[[note#^<id>]]` link. */
  blockId: string;
  /**
   * Non-null when the paragraph doesn't already have an id: insert
   * `text` at absolute offset `at`. Caller applies the edit.
   */
  edit: { at: number; text: string } | null;
}

/**
 * Walk out from `pos` to the surrounding paragraph (a run of consecutive
 * non-blank lines). Returns null when `pos` lands on a blank line — the
 * caller should treat that as "nothing to anchor here."
 */
export function planBlockLink(
  content: string,
  pos: number,
  generateId: () => string = defaultGenerateId,
): BlockLinkPlan | null {
  if (pos < 0 || pos > content.length) return null;

  const { lineStart, lineEnd } = lineBoundsAt(content, pos);
  const lineText = content.slice(lineStart, lineEnd);
  if (lineText.trim() === '') return null;

  // Walk up while the previous line is non-blank.
  let fromStart = lineStart;
  while (fromStart > 0) {
    const prevEnd = fromStart - 1; // char before start-of-current-line is '\n'
    if (content[prevEnd] !== '\n') break; // paragraph starts at doc start
    const prev = lineBoundsAt(content, prevEnd - 1);
    if (content.slice(prev.lineStart, prev.lineEnd).trim() === '') break;
    fromStart = prev.lineStart;
  }

  // Walk down while the next line is non-blank.
  let toEnd = lineEnd;
  while (toEnd < content.length) {
    if (content[toEnd] !== '\n') break;
    const next = lineBoundsAt(content, toEnd + 1);
    if (content.slice(next.lineStart, next.lineEnd).trim() === '') break;
    toEnd = next.lineEnd;
  }

  const paragraph = content.slice(fromStart, toEnd);
  const existing = paragraph.match(BLOCK_ID_END_RE);
  if (existing) return { blockId: existing[1], edit: null };

  const blockId = generateId();
  const lastLineText = (() => {
    const last = lineBoundsAt(content, toEnd === fromStart ? toEnd : toEnd - 1);
    return content.slice(last.lineStart, last.lineEnd);
  })();
  const sep = lastLineText.length > 0 && !/\s$/.test(lastLineText) ? ' ' : '';
  return { blockId, edit: { at: toEnd, text: `${sep}^${blockId}` } };
}

/** Default id generator — 6 base-36 chars. Collision odds are ~1 in 2 billion. */
export function defaultGenerateId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function lineBoundsAt(content: string, pos: number): { lineStart: number; lineEnd: number } {
  const clamped = Math.max(0, Math.min(pos, content.length));
  let lineStart = clamped;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') lineStart--;
  let lineEnd = clamped;
  while (lineEnd < content.length && content[lineEnd] !== '\n') lineEnd++;
  return { lineStart, lineEnd };
}
