/**
 * Pure geometry + text-matching helpers behind the PDF viewer's text layer and
 * excerpt-highlight overlay (#100, extracted from PdfViewer.svelte for #672 —
 * and so the viewer's pdfjs-coupled logic is unit-tested ahead of the pdfjs 6
 * bump, #689).
 *
 * DOM-free: these compute positions / rectangles from the pdfjs text-content
 * items + viewport, and the component does the actual span/div painting from
 * what they return. That keeps the fiddly affine math + citedText matching
 * testable without a canvas or a live pdfjs document.
 */

/** The slice of a pdfjs TextContent item we read. */
export interface TextLayerItem {
  str?: string;
  transform: number[];
  width: number;
  height: number;
}

/** The slice of a pdfjs viewport we read: dimensions + page→viewport affine. */
export interface ViewportLike {
  width: number;
  height: number;
  transform: number[];
}

export interface ItemBox {
  left: number;
  top: number;
  fontSize: number;
}

// Zoom bounds — shared by the toolbar buttons, keyboard shortcuts, and reset.
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3.0;
export const SCALE_STEP = 0.15;
export const DEFAULT_SCALE = 1.2;

export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

/** One zoom-in step, clamped to MAX and rounded to 2dp (float-drift guard). */
export function zoomInScale(scale: number): number {
  return Math.min(MAX_SCALE, +(scale + SCALE_STEP).toFixed(2));
}

/** One zoom-out step, clamped to MIN and rounded to 2dp. */
export function zoomOutScale(scale: number): number {
  return Math.max(MIN_SCALE, +(scale - SCALE_STEP).toFixed(2));
}

/**
 * Project a text item into CSS pixels by composing its text matrix with the
 * viewport transform. pdfjs page coords are bottom-left origin; the viewport
 * transform flips Y and applies the user scale, so `out = viewport ∘ item`.
 * Returns the span's top-left corner + font size.
 */
export function itemPosition(item: { transform: number[] }, viewport: ViewportLike): ItemBox {
  // Both are 6-element affine matrices (pdfjs invariant).
  const t = item.transform as [number, number, number, number, number, number];
  const v = viewport.transform as [number, number, number, number, number, number];
  const a = v[0] * t[0] + v[2] * t[1];
  const b = v[1] * t[0] + v[3] * t[1];
  const e = v[0] * t[4] + v[2] * t[5] + v[4];
  const f = v[1] * t[4] + v[3] * t[5] + v[5];
  const fontSize = Math.hypot(a, b);
  return { left: e, top: f - fontSize, fontSize };
}

/**
 * Normalize whitespace + zero-width chars so substring search is robust against
 * PDF hyphenation / soft-line-break noise. Soft hyphen (U+00AD), zero-width
 * space (U+200B), and zero-width non-joiner (U+200C) are invisible noise PDFs
 * love; collapse runs of whitespace, drop those, trim, lower-case.
 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/[\u00AD\u200B\u200C]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Flatten a page's text items into a single char string plus a parallel
 * char→item-index map, so a match range can be resolved back to the items (and
 * thus the bounding boxes) it spans. A trailing space per item preserves word
 * boundaries between adjacent items.
 */
export function buildPageText(items: TextLayerItem[]): { haystack: string; charToItem: number[] } {
  const chars: string[] = [];
  const charToItem: number[] = [];
  items.forEach((it, idx) => {
    if (typeof it.str !== 'string') return;
    for (const ch of it.str) {
      chars.push(ch);
      charToItem.push(idx);
    }
    chars.push(' ');
    charToItem.push(idx);
  });
  return { haystack: chars.join(''), charToItem };
}

/** The slice of a SourceExcerpt the overlay matches against. */
export interface ExcerptLike {
  excerptId: string;
  citedText: string | null;
  page: string | null;
}

export interface HighlightRect {
  excerptId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The highlight rectangles for every excerpt whose cited text is found on the
 * current page. Page-filtered (an excerpt with a page hint only matches its own
 * page; no hint → still tried), normalized substring match, resolved back to
 * the union of text items the match spans — one rect per contributing item, so
 * a multi-line match yields a stacked set.
 */
export function findExcerptRects(
  items: TextLayerItem[],
  excerpts: ExcerptLike[],
  viewport: ViewportLike,
  scale: number,
  currentPage: number,
): HighlightRect[] {
  const { haystack, charToItem } = buildPageText(items);
  const haystackNorm = normalizeForMatch(haystack);
  const rects: HighlightRect[] = [];

  for (const e of excerpts) {
    if (e.page != null) {
      const ep = parseInt(e.page, 10);
      if (Number.isFinite(ep) && ep !== currentPage) continue;
    }
    if (!e.citedText) continue;
    const needle = normalizeForMatch(e.citedText);
    if (!needle) continue;
    const start = haystackNorm.indexOf(needle);
    if (start < 0) continue;
    const end = start + needle.length;

    const itemSet = new Set<number>();
    for (let i = start; i < end && i < charToItem.length; i++) {
      itemSet.add(charToItem[i]!);
    }
    for (const idx of itemSet) {
      const it = items[idx];
      if (!it || typeof it.str !== 'string') continue;
      const { left, top, fontSize } = itemPosition(it, viewport);
      rects.push({
        excerptId: e.excerptId,
        left,
        top,
        width: it.width * scale,
        height: fontSize * 1.15,
      });
    }
  }
  return rects;
}
