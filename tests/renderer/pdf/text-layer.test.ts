import { describe, it, expect } from 'vitest';
import {
  MIN_SCALE, MAX_SCALE, DEFAULT_SCALE,
  clampScale, zoomInScale, zoomOutScale,
  itemPosition, normalizeForMatch, buildPageText, findExcerptRects,
  type TextLayerItem, type ViewportLike, type ExcerptLike,
} from '../../../src/renderer/lib/pdf/text-layer';

// A pdfjs viewport at scale `s` on a page of height `h` flips Y: [s,0,0,-s,0,h*s].
const viewport = (s: number, h: number): ViewportLike => ({
  width: 600, height: h * s, transform: [s, 0, 0, -s, 0, h * s],
});
// A text item's matrix: [fontSize,0,0,fontSize,x,y] at bottom-left-origin (x,y).
const item = (over: Partial<TextLayerItem> & { x?: number; y?: number; fs?: number } = {}): TextLayerItem => ({
  str: over.str ?? 'text',
  transform: [over.fs ?? 10, 0, 0, over.fs ?? 10, over.x ?? 0, over.y ?? 0],
  width: over.width ?? 40,
  height: over.height ?? 10,
});

describe('zoom helpers', () => {
  it('steps in/out and clamps to [MIN, MAX]', () => {
    expect(zoomInScale(DEFAULT_SCALE)).toBe(1.35); // 1.2 + 0.15
    expect(zoomOutScale(DEFAULT_SCALE)).toBe(1.05);
    expect(zoomInScale(2.95)).toBe(MAX_SCALE);   // clamps up
    expect(zoomOutScale(0.55)).toBe(MIN_SCALE);  // clamps down
  });
  it('rounds to 2dp to avoid float drift', () => {
    expect(zoomInScale(0.5)).toBe(0.65);
    expect(Number.isInteger(zoomInScale(0.5) * 100)).toBe(true);
  });
  it('clampScale bounds arbitrary values', () => {
    expect(clampScale(10)).toBe(MAX_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(1.2)).toBe(1.2);
  });
});

describe('normalizeForMatch', () => {
  it('collapses whitespace, trims, lower-cases', () => {
    expect(normalizeForMatch('  Hello   World \n ')).toBe('hello world');
  });
  it('strips soft-hyphen + zero-width noise PDFs inject', () => {
    expect(normalizeForMatch('co­oper​ate')).toBe('cooperate');
  });
});

describe('itemPosition (affine compose)', () => {
  it('projects a text item into CSS pixels through the flipped viewport', () => {
    // s=2, fontSize=10, x=5, y=700, page height 792.
    const box = itemPosition(item({ x: 5, y: 700, fs: 10 }), viewport(2, 792));
    expect(box.left).toBe(10);              // s*x
    expect(box.fontSize).toBe(20);          // s*fontSize
    expect(box.top).toBe(2 * (792 - 700) - 20); // s*(h-y) - fontSize = 164
  });
});

describe('buildPageText', () => {
  it('flattens items to chars + a parallel char→item map, with item-boundary spaces', () => {
    const { haystack, charToItem } = buildPageText([item({ str: 'ab' }), item({ str: 'cd' })]);
    expect(haystack).toBe('ab cd ');
    expect(charToItem).toEqual([0, 0, 0, 1, 1, 1]); // a,b,<space>→0 ; c,d,<space>→1
  });
  it('skips non-text (marked-content) items', () => {
    const { haystack } = buildPageText([{ transform: [], width: 0, height: 0 }, item({ str: 'x' })]);
    expect(haystack).toBe('x ');
  });
});

describe('findExcerptRects', () => {
  const vp = viewport(1, 100);
  const ex = (over: Partial<ExcerptLike>): ExcerptLike => ({ excerptId: 'e1', citedText: null, page: null, ...over });

  it('returns a rect for an excerpt whose cited text is found on the page', () => {
    const items = [item({ str: 'quantum', x: 10, y: 80, fs: 12, width: 50 })];
    const rects = findExcerptRects(items, [ex({ citedText: 'Quantum' })], vp, 1, 1);
    expect(rects).toHaveLength(1);
    expect(rects[0].excerptId).toBe('e1');
    expect(rects[0].width).toBe(50);       // item.width * scale
    expect(rects[0].left).toBe(10);
  });

  it('skips an excerpt whose page hint is a different page', () => {
    const items = [item({ str: 'quantum' })];
    expect(findExcerptRects(items, [ex({ citedText: 'quantum', page: '7' })], vp, 1, 1)).toHaveLength(0);
    // No page hint → still matched.
    expect(findExcerptRects(items, [ex({ citedText: 'quantum', page: null })], vp, 1, 1)).toHaveLength(1);
  });

  it('matches across adjacent items (multi-item span → one rect per item)', () => {
    const items = [
      item({ str: 'hello', x: 0, y: 50, width: 30 }),
      item({ str: 'world', x: 35, y: 50, width: 30 }),
    ];
    // "hello world" spans both items (the inter-item space bridges them).
    const rects = findExcerptRects(items, [ex({ citedText: 'hello world' })], vp, 1, 1);
    expect(rects).toHaveLength(2);
  });

  it('returns nothing when the cited text is absent or empty', () => {
    const items = [item({ str: 'present' })];
    expect(findExcerptRects(items, [ex({ citedText: 'absent' })], vp, 1, 1)).toHaveLength(0);
    expect(findExcerptRects(items, [ex({ citedText: '' })], vp, 1, 1)).toHaveLength(0);
    expect(findExcerptRects(items, [ex({ citedText: null })], vp, 1, 1)).toHaveLength(0);
  });

  it('scales rect width by the zoom factor', () => {
    const items = [item({ str: 'zoomed', width: 40 })];
    const rects = findExcerptRects(items, [ex({ citedText: 'zoomed' })], vp, 2, 1);
    expect(rects[0].width).toBe(80); // 40 * 2
  });
});
