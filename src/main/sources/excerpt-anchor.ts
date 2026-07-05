/**
 * Best-effort anchoring of a clipped selection into the extracted body.md (#794).
 *
 * The selection text comes from the raw page DOM, but `body.md` is the
 * Readability + Turndown extraction — Readability strips page chrome and
 * Turndown reshapes the rest into markdown, so raw DOM offsets don't map. We
 * re-find the selection in `body.md` whitespace-tolerantly and return character
 * offsets ONLY when the match is unambiguous.
 *
 * Deliberately conservative (per #794): if the selection isn't found, or it
 * occurs more than once, we return null and let the excerpt stay text-anchored
 * rather than guess a wrong location. Inline markdown markers around the
 * selection (`**bold**`, `[link](url)`) don't break the match — they're not
 * whitespace and the selection text remains a substring — but markup *inside*
 * the selection (a word bolded mid-phrase) legitimately yields no clean match,
 * which we treat as "leave it null".
 */

export interface ExcerptOffsets {
  /** 0-based, inclusive start offset into body.md. */
  charStart: number;
  /** 0-based, exclusive end offset into body.md. */
  charEnd: number;
}

/** Collapse all whitespace runs to a single space and trim the ends. */
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Whitespace-normalized view of `body` plus a `map` from each normalized-string
 * index back to its originating offset in `body`. A collapsed space maps to the
 * first character of the whitespace run it replaced; leading/trailing whitespace
 * is dropped, so the normalized string mirrors `collapseWhitespace`'s output.
 */
function normalizeWithMap(body: string): { normalized: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  let inWs = false;
  let wsRunStart = -1;
  for (let i = 0; i < body.length; i++) {
    if (/\s/.test(body[i]!)) {
      if (!inWs) { inWs = true; wsRunStart = i; }
      continue;
    }
    if (inWs) {
      // Emit one collapsed space — but skip leading whitespace so the
      // normalized view is trimmed at the front.
      if (chars.length > 0) { chars.push(' '); map.push(wsRunStart); }
      inWs = false;
    }
    chars.push(body[i]!);
    map.push(i);
  }
  return { normalized: chars.join(''), map };
}

/**
 * Locate `selection` within `body` and return its body.md character offsets, or
 * null when there's no unambiguous single match.
 */
export function locateExcerptOffsets(body: string, selection: string): ExcerptOffsets | null {
  const needle = collapseWhitespace(selection);
  if (!needle) return null;

  const { normalized, map } = normalizeWithMap(body);
  const first = normalized.indexOf(needle);
  if (first === -1) return null;
  // More than one occurrence — anchoring to either would be a guess.
  if (normalized.indexOf(needle, first + 1) !== -1) return null;

  const charStart = map[first]!;
  const charEnd = map[first + needle.length - 1]! + 1;
  return { charStart, charEnd };
}
