/**
 * Markdown heading extraction (#476).
 *
 * Shared between OutlinePanel (right-sidebar tree) and BreadcrumbsBar
 * (cursor-aware chain above the editor). Both want the same source-of-
 * truth: a flat list of headings with level + text + line.
 *
 * Intentionally narrow: ATX-style only (`#` … `######`). Setext-style
 * (`===` / `---` underlines) is not used in Minerva notebases and
 * skipping it keeps the parser O(n) per line.
 */

import { slugify } from '../../../shared/slug';

export interface Heading {
  /** ATX level: 1 (`#`) through 6 (`######`). */
  level: number;
  /** Heading text with the leading `#` markers + whitespace trimmed. */
  text: string;
  /** 1-based line number — matches CodeMirror's line numbering and the
   *  `onScrollToLine` callback contract. */
  line: number;
}

/** Parse all ATX-style headings out of a markdown document. */
export function extractHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      out.push({ level: match[1].length, text: match[2].trim(), line: i + 1 });
    }
  }
  return out;
}

/**
 * Resolve the active heading chain at `cursorLine` — the path from
 * document root down through every ancestor heading that contains the
 * cursor, ending at the most-recent heading whose line ≤ cursor.
 *
 * Example, given headings `# A` @1, `## B` @5, `### C` @9, `## D` @20:
 *   - cursor at line 10 → [A, B, C]
 *   - cursor at line 22 → [A, D]
 *   - cursor at line 3 (before any heading) → []
 *
 * Returns `[]` when the cursor sits before the first heading.
 */
export function activeHeadingChain(headings: readonly Heading[], cursorLine: number): Heading[] {
  // Walk forward to find the latest heading at-or-before the cursor.
  let activeIdx = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].line <= cursorLine) activeIdx = i;
    else break;
  }
  if (activeIdx < 0) return [];

  // Walk backward from `activeIdx` collecting headings whose level is
  // strictly shallower than the previous one — that's the ancestor
  // chain. The active heading itself is the leaf of the chain.
  const chain: Heading[] = [headings[activeIdx]];
  let needLevel = headings[activeIdx].level;
  for (let i = activeIdx - 1; i >= 0 && needLevel > 1; i--) {
    if (headings[i].level < needLevel) {
      chain.unshift(headings[i]);
      needLevel = headings[i].level;
    }
  }
  return chain;
}

/**
 * The nearest heading at or above a character offset, as a `{ slug, text }`
 * suitable for a section bookmark (#755). Returns `null` when the offset sits
 * before any heading. The slug is computed with the same `slugify` the wiki-
 * link indexer uses, so `[[note#slug]]` navigation resolves it.
 */
export function sectionAnchorAt(
  content: string,
  offset: number,
): { slug: string; text: string } | null {
  const clamped = Math.max(0, Math.min(offset, content.length));
  // 1-based line of the cursor — matches `Heading.line`.
  const cursorLine = content.slice(0, clamped).split('\n').length;
  const chain = activeHeadingChain(extractHeadings(content), cursorLine);
  const heading = chain.at(-1);
  if (!heading) return null;
  const slug = slugify(heading.text);
  return slug ? { slug, text: heading.text } : null;
}
