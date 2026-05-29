/**
 * Find an excerpt's `citedText` inside a rendered DOM container (#102).
 *
 * Used by the source-viewer density gutter to compute each excerpt's
 * vertical position within the rendered body. Walks text nodes in
 * document order, normalises whitespace (so soft line wraps and
 * paragraph breaks don't defeat substring search), and returns a
 * Range covering the first match — or null when the text doesn't
 * appear in the rendered body at all (the user may have edited the
 * body after creating the excerpt).
 */

/** Strip soft-hyphen / zero-width chars and collapse runs of
 *  whitespace, lower-cased — same shape as the PDF viewer's
 *  highlight matcher so the two surfaces find the same text.
 *  U+00AD soft hyphen, U+200B zero-width space, U+200C zero-width
 *  non-joiner are the invisible characters that show up in PDF
 *  extractions and break naive substring search. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/[\u00AD\u200B\u200C]/g, '')
    .trim()
    .toLowerCase();
}

interface CharIndex {
  /** Concatenated normalised text of the whole container, separated
   *  by single spaces at element boundaries so words from adjacent
   *  blocks don't fuse. */
  text: string;
  /** For each character in `text`, the source (node, offsetInNode)
   *  pair that produced it. Used to map a match back to a Range. */
  nodes: Array<{ node: Text; offset: number }>;
}

function buildIndex(container: HTMLElement): CharIndex {
  const text: string[] = [];
  const nodes: CharIndex['nodes'] = [];

  // Walk text nodes in document order. TreeWalker is the standard
  // way; `acceptNode` skips invisible (display:none) subtrees so we
  // don't index hidden helpers that happen to share text.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement;
      if (!el) return NodeFilter.FILTER_REJECT;
      // Skip the gutter and any other excerpt-related chrome we
      // render inside the container — they're noise for the match.
      if (el.closest('.excerpt-density-gutter')) return NodeFilter.FILTER_REJECT;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let prevParent: Node | null = null;
  let cur: Node | null = walker.nextNode();
  while (cur) {
    const node = cur as Text;
    const parent = node.parentNode;
    // Block boundary: insert a synthetic space between adjacent text
    // runs whose parent elements differ. Stops "endOfPara" + "Next
    // line" fusing into "endOfParaNext line".
    if (prevParent && parent !== prevParent && text.length > 0) {
      text.push(' ');
      nodes.push({ node, offset: 0 });
    }
    const raw = node.data;
    for (let i = 0; i < raw.length; i++) {
      text.push(raw[i]);
      nodes.push({ node, offset: i });
    }
    prevParent = parent;
    cur = walker.nextNode();
  }

  return { text: text.join(''), nodes };
}

/**
 * Find the first occurrence of `needle` in `container` and return a
 * DOM Range covering it. Returns null when no match is found.
 *
 * The match is normalised on both sides (whitespace collapsed,
 * soft-hyphens stripped, case-insensitive) so the typical noise that
 * shows up in PDF / OCR extractions doesn't defeat substring search.
 */
export function findExcerptRange(container: HTMLElement, citedText: string): Range | null {
  const needle = normalizeForMatch(citedText);
  if (!needle) return null;
  const idx = buildIndex(container);

  // Map normalised haystack → original-character indices so we can
  // search in the normalised string and still locate the actual DOM
  // positions of the start / end. Each char of `normalized` carries
  // the original-index of the character it derived from; runs of
  // whitespace collapse to one space whose original-index is the
  // first whitespace in the run.
  const normalized: string[] = [];
  const origAt: number[] = [];
  let inSpace = false;
  for (let i = 0; i < idx.text.length; i++) {
    const ch = idx.text[i];
    if (/\s/.test(ch)) {
      if (!inSpace) {
        normalized.push(' ');
        origAt.push(i);
        inSpace = true;
      }
    } else if (ch === '\u00AD' || ch === '\u200B' || ch === '\u200C') {
      continue;
    } else {
      normalized.push(ch.toLowerCase());
      origAt.push(i);
      inSpace = false;
    }
  }
  const haystack = normalized.join('').trim();
  if (!haystack) return null;
  // Offset the trim chopped off the head — preserve so we can map
  // back. The trim only strips a leading space, which maps to a
  // single original index; subtract its count.
  const leadingSpaceCount = normalized.length > 0 && normalized[0] === ' ' ? 1 : 0;

  const hit = haystack.indexOf(needle);
  if (hit < 0) return null;

  const startOrig = origAt[hit + leadingSpaceCount];
  const endOrigIncl = origAt[hit + leadingSpaceCount + needle.length - 1];
  if (startOrig == null || endOrigIncl == null) return null;

  // Build the Range from the original-index → DOM position map.
  const startInfo = idx.nodes[startOrig];
  const endInfo = idx.nodes[endOrigIncl];
  if (!startInfo || !endInfo) return null;

  const range = document.createRange();
  try {
    range.setStart(startInfo.node, startInfo.offset);
    range.setEnd(endInfo.node, Math.min(endInfo.node.data.length, endInfo.offset + 1));
    return range;
  } catch {
    return null;
  }
}
