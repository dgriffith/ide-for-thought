/**
 * @vitest-environment jsdom
 *
 * Diagram nodes survive the `{@html rendered}` swap (#2323, C3 §3c remainder).
 *
 * `Preview.svelte` replaces its whole subtree on every ~120ms render tick, so
 * `.mermaid-block:not([data-mermaid-rendered])` was never false — it was never
 * *asked*, because the element the attribute was written on no longer existed.
 * Every tick re-ran `mermaid.render()`: measured at 17-22ms of dagre layout for
 * the four- and five-node flowcharts the tutorial thoughtbase ships, and 79ms
 * for a thirty-node one, per diagram, on the renderer's main thread.
 *
 * Every test here drives the real hydrator with a **fresh placeholder per
 * tick** (#2229) — what the swap actually produces. Reusing one element would
 * exercise the guard that already works rather than the situation it fails in.
 *
 * And every count gate is paired with a rendering assertion: "N ticks, one
 * render" is equally satisfied by a block that draws nothing after tick one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const initialize = vi.fn();
/** Each render returns a distinct SVG so a restored node is identifiable. */
let renderSeq = 0;
const bound: Element[] = [];
const render = vi.fn(async (_id: string, source: string) => {
  const n = ++renderSeq;
  if (source.includes('BOOM')) throw new Error('Parse error on line 1');
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" data-seq="${n}"><g class="node clickable" id="n-${n}"></g></svg>`,
    // Stands in for the real `bindFunctions`: mermaid's own installs
    // mouseover/mouseout tooltip handlers on `.clickable` nodes even under the
    // app's `securityLevel: 'strict'` (measured in Chromium against mermaid
    // 11.17.2). Caching the SVG *string* and re-inserting it would silently
    // drop them — a diagram that looks right and stops responding.
    bindFunctions: (el: Element) => {
      bound.push(el);
      el.querySelectorAll('.clickable').forEach((node) => {
        node.addEventListener('mouseover', () => {
          node.setAttribute('data-tooltip-shown', '1');
        });
      });
    },
  };
});

vi.mock('mermaid', () => ({ default: { initialize, render } }));
vi.mock('../../../src/renderer/lib/theme', () => ({
  getThemeMode: () => 'dark',
  getEffectiveTheme: () => 'dark',
}));

import { hydrateMermaidBlocks, invalidateMermaidTheme } from '../../../src/renderer/lib/markdown/mermaid-renderer';
import { blockCacheFor, disposeCaches } from '../../../src/renderer/lib/markdown/hydrated-block-cache';

const FLOW = 'flowchart LR\n  A[Write a note] --> B[Minerva indexes it]';
const OTHER = 'graph TD\n  G[Variety] -->|supports| C[Control faction]';

/** A stable `.preview`-alike root; `{@html}` swaps its children, not itself. */
function previewRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

/**
 * One render tick: `{@html rendered}` discards the whole subtree and inserts
 * brand-new placeholder elements carrying the same source text.
 */
function tick(root: HTMLElement, ...sources: string[]): HTMLElement[] {
  root.innerHTML = '';
  return sources.map((source) => {
    const block = document.createElement('div');
    block.className = 'mermaid-block';
    block.textContent = source;
    root.appendChild(block);
    return block;
  });
}

/** The SVG a block is currently showing, by the seq baked into each render. */
function seqOf(block: HTMLElement): string | null {
  return block.querySelector('svg')?.getAttribute('data-seq') ?? null;
}

beforeEach(() => {
  document.body.innerHTML = '';
  initialize.mockClear();
  render.mockClear();
  renderSeq = 0;
  bound.length = 0;
  invalidateMermaidTheme();
});

describe('mermaid hydration across render ticks (#2323)', () => {
  it('renders ONCE across eight render ticks, and every tick still shows the diagram', async () => {
    const root = previewRoot();
    for (let i = 0; i < 8; i++) {
      const [block] = tick(root, FLOW);
      await hydrateMermaidBlocks(root);
      // The guard that stops the count gate passing vacuously: an empty block
      // would satisfy "eight ticks, one render" just as well.
      expect(seqOf(block!)).toBe('1');
      expect(block!.getAttribute('data-mermaid-rendered')).toBe('ok');
    }
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('reuses the NODE, not the markup — the bound handlers still respond', async () => {
    const root = previewRoot();
    const [first] = tick(root, FLOW);
    await hydrateMermaidBlocks(root);
    const svg = first!.querySelector('svg')!;
    const node = svg.querySelector('.clickable')!;

    const [second] = tick(root, FLOW);
    await hydrateMermaidBlocks(root);

    // Literally the same nodes, so nothing bound to them had to be re-bound.
    expect(second!.querySelector('svg')).toBe(svg);
    expect(second!.querySelector('.clickable')).toBe(node);

    // The assertion the naive "cache the SVG string" fix fails.
    node.dispatchEvent(new Event('mouseover'));
    expect(node.getAttribute('data-tooltip-shown')).toBe('1');
    expect(bound).toHaveLength(1);
  });

  it('edits to the diagram source re-render — the cache is not a freeze', async () => {
    const root = previewRoot();
    tick(root, FLOW);
    await hydrateMermaidBlocks(root);

    const [edited] = tick(root, `${FLOW}\n  B --> C[Query it]`);
    await hydrateMermaidBlocks(root);

    expect(render).toHaveBeenCalledTimes(2);
    expect(seqOf(edited!)).toBe('2');
  });

  it('two blocks with identical source get their own node, not one shared one', async () => {
    const root = previewRoot();
    const first = tick(root, FLOW, FLOW);
    await hydrateMermaidBlocks(root);
    expect(render).toHaveBeenCalledTimes(2);
    expect(seqOf(first[0]!)).toBe('1');
    expect(seqOf(first[1]!)).toBe('2');

    const second = tick(root, FLOW, FLOW);
    await hydrateMermaidBlocks(root);

    // Both restored, each to its own occurrence — a single-node cache would
    // leave the first block empty and give both ticks the same SVG.
    expect(render).toHaveBeenCalledTimes(2);
    expect(seqOf(second[0]!)).toBe('1');
    expect(seqOf(second[1]!)).toBe('2');
  });

  it('inserting a different diagram above does not invalidate the one below', async () => {
    const root = previewRoot();
    tick(root, FLOW);
    await hydrateMermaidBlocks(root);
    expect(render).toHaveBeenCalledTimes(1);

    const blocks = tick(root, OTHER, FLOW);
    await hydrateMermaidBlocks(root);

    // Only the new diagram renders; keying on a whole-pass ordinal would have
    // renumbered the existing one and re-run its layout.
    expect(render).toHaveBeenCalledTimes(2);
    expect(seqOf(blocks[1]!)).toBe('1');
    expect(seqOf(blocks[0]!)).toBe('2');
  });

  it('a theme change drops the cache — diagrams re-render with new variables', async () => {
    const root = previewRoot();
    tick(root, FLOW);
    await hydrateMermaidBlocks(root);
    expect(render).toHaveBeenCalledTimes(1);

    invalidateMermaidTheme();

    const [block] = tick(root, FLOW);
    await hydrateMermaidBlocks(root);

    expect(render).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(seqOf(block!)).toBe('2');
  });

  it('a parse error is cached too — a broken diagram is not re-parsed every tick', async () => {
    const root = previewRoot();
    for (let i = 0; i < 4; i++) {
      const [block] = tick(root, 'flowchart LR\n  BOOM');
      await hydrateMermaidBlocks(root);
      expect(block!.getAttribute('data-mermaid-rendered')).toBe('error');
      expect(block!.textContent).toContain('Parse error on line 1');
    }
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('does not accumulate an entry per tick, and evicts a deleted diagram', async () => {
    const root = previewRoot();
    for (let i = 0; i < 6; i++) {
      tick(root, FLOW, OTHER);
      await hydrateMermaidBlocks(root);
    }
    const cache = blockCacheFor(root, 'mermaid');
    expect(cache.size).toBe(2);

    // The second diagram is deleted from the note.
    tick(root, FLOW);
    await hydrateMermaidBlocks(root);
    expect(cache.size).toBe(1);

    // And a note with no diagrams at all still sweeps.
    tick(root);
    await hydrateMermaidBlocks(root);
    expect(cache.size).toBe(0);
  });

  it('one preview root does not evict another preview root cached diagrams', async () => {
    const a = previewRoot();
    const b = previewRoot();
    const [blockA] = tick(a, FLOW);
    await hydrateMermaidBlocks(a);
    tick(b, OTHER);
    await hydrateMermaidBlocks(b);
    expect(render).toHaveBeenCalledTimes(2);

    // A second tick in preview B must not sweep preview A's entry.
    tick(b, OTHER);
    await hydrateMermaidBlocks(b);
    expect(blockCacheFor(a, 'mermaid').size).toBe(1);
    expect(seqOf(blockA!)).toBe('1');

    const [again] = tick(a, FLOW);
    await hydrateMermaidBlocks(a);
    expect(render).toHaveBeenCalledTimes(2);
    expect(seqOf(again!)).toBe('1');
  });

  it('the attribute guard still skips a repeat pass over the SAME rendered HTML', async () => {
    const root = previewRoot();
    const [block] = tick(root, FLOW);
    await hydrateMermaidBlocks(root);

    // `revision` bumping re-runs the post-render effect without a new `{@html}`
    // swap: nothing to do, and nothing swept away either.
    await hydrateMermaidBlocks(root);

    expect(render).toHaveBeenCalledTimes(1);
    expect(seqOf(block!)).toBe('1');
    expect(blockCacheFor(root, 'mermaid').size).toBe(1);
  });

  it('disposeCaches drops everything — a destroyed preview re-renders from scratch', async () => {
    const root = previewRoot();
    tick(root, FLOW);
    await hydrateMermaidBlocks(root);
    disposeCaches(root);

    const [block] = tick(root, FLOW);
    await hydrateMermaidBlocks(root);

    expect(render).toHaveBeenCalledTimes(2);
    expect(seqOf(block!)).toBe('2');
  });
});
