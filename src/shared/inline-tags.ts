/**
 * Inline `#tag` lexing — the ONE definition of what counts as a body tag.
 *
 * Moved out of `main/graph/parser.ts` (#2430) so the tag merge/rename rewrite
 * and the indexer can't disagree about what a tag is. If the rewrite matched
 * something the indexer doesn't index, it would edit text that isn't a tag; if
 * it missed something the indexer does index, the old tag would survive the
 * merge in the Tags panel. Sharing the lexer makes both impossible.
 *
 * The rules (unchanged from the parser):
 *   - Fenced code (```…```) and inline code spans are removed before matching.
 *   - A tag is `#` preceded by start-of-text or whitespace, then a letter, then
 *     word chars, `-` or `/`. So a heading (`# Title`), a URL fragment
 *     (`https://x.org/page#ml`) and a markdown anchor link (`[a](#ml)`) are
 *     never tags.
 *   - Trailing slashes are dropped; every `/`-segment must itself look like a
 *     tag identifier, or the whole match is rejected (#466).
 *
 * Pure: no Node builtins (src/shared is lint-enforced pure, #668).
 */

/** Fenced code blocks and inline code spans. Stripped before tag/link
 *  extraction. */
export const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`\n]+`/g;

/** A body tag: `#` after start-of-text or whitespace. Group 1 is the raw name
 *  (may carry trailing slashes or malformed segments — see
 *  {@link normalizeNestedTag}). */
export const INLINE_TAG_RE = /(?:^|\s)#([a-zA-Z][\w-/]*)/g;

/** Each `/`-delimited segment of a nested tag must look like a normal
 *  tag identifier — letter, then word chars or hyphens. Empty segments
 *  (`#a//b`) and segments starting with non-letter (`#a/1b`) are
 *  rejected so the tree view (#466) never sprouts garbage levels. */
const TAG_SEGMENT_RE = /^[a-zA-Z][\w-]*$/;

/**
 * Strip a trailing slash and validate every `/`-delimited segment.
 * Returns null when any segment is malformed — the indexer treats
 * that as "this isn't actually a tag", same as a bare `#` would be.
 */
export function normalizeNestedTag(raw: string): string | null {
  const trimmed = raw.replace(/\/+$/, '');
  if (!trimmed) return null;
  const parts = trimmed.split('/');
  for (const p of parts) {
    if (!TAG_SEGMENT_RE.test(p)) return null;
  }
  return parts.join('/');
}

/** True when `name` (no leading `#`) is a tag name an inline `#name` would
 *  index as exactly `name`. */
export function isValidTagName(name: string): boolean {
  return normalizeNestedTag(name) === name;
}

/** One inline tag occurrence, with offsets into the ORIGINAL content. */
export interface InlineTagOccurrence {
  /** Normalized tag name (no `#`, no trailing slash). */
  tag: string;
  /** Offset of the first character of the name (just after the `#`). */
  start: number;
  /** Offset just past the normalized name. */
  end: number;
}

/**
 * Every inline tag occurrence in `content`, located in the original text.
 *
 * Matches exactly what {@link extractInlineTags} (and so the indexer) sees:
 * the regex runs over the code-stripped text, and each hit is mapped back to
 * the original offsets. A hit whose characters aren't contiguous in the
 * original — `#m\`x\`l` strips to `#ml` — is not a tag anyone wrote, and is
 * reported as nothing rather than as a span that straddles code.
 */
export function findInlineTags(content: string): InlineTagOccurrence[] {
  // Build the stripped text plus the original offset each kept segment
  // starts at, so a stripped position maps back in O(log n).
  const segStripped: number[] = [];
  const segOriginal: number[] = [];
  let stripped = '';
  let cursor = 0;
  CODE_BLOCK_RE.lastIndex = 0;
  let code: RegExpExecArray | null;
  while ((code = CODE_BLOCK_RE.exec(content)) !== null) {
    if (code.index > cursor) {
      segStripped.push(stripped.length);
      segOriginal.push(cursor);
      stripped += content.slice(cursor, code.index);
    }
    cursor = code.index + code[0].length;
  }
  if (cursor < content.length) {
    segStripped.push(stripped.length);
    segOriginal.push(cursor);
    stripped += content.slice(cursor);
  }

  const segmentOf = (pos: number): number => {
    let lo = 0;
    let hi = segStripped.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segStripped[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const out: InlineTagOccurrence[] = [];
  INLINE_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_TAG_RE.exec(stripped)) !== null) {
    const raw = m[1]!;
    const tag = normalizeNestedTag(raw);
    if (!tag) continue;
    // The `#` is the character before the name; it and the name must sit in
    // one kept segment. (`see \`x\`#ml` strips to `see #ml`, which the indexer
    // DOES read as a tag — and here the `#ml` is contiguous, so it's reported
    // too. Only a hit split by code, `#m\`x\`l`, is dropped.)
    const nameStart = m.index + m[0].length - raw.length;
    const hashPos = nameStart - 1;
    const lastPos = nameStart + tag.length - 1;
    const seg = segmentOf(hashPos);
    if (segmentOf(lastPos) !== seg) continue;
    const delta = segOriginal[seg]! - segStripped[seg]!;
    out.push({ tag, start: nameStart + delta, end: nameStart + tag.length + delta });
  }
  return out;
}

/** Distinct inline tag names in `content` (code stripped, nested-validated). */
export function extractInlineTags(content: string): string[] {
  const tags = new Set<string>();
  const stripped = content.replace(CODE_BLOCK_RE, '');
  INLINE_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_TAG_RE.exec(stripped)) !== null) {
    const cleaned = normalizeNestedTag(match[1]!);
    if (cleaned) tags.add(cleaned);
  }
  return [...tags];
}
