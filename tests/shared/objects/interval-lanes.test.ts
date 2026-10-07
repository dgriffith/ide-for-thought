/**
 * Lane packing (#2611): deterministic first-fit by lane index, in start →
 * end → title → key order. See `docs/vision/objects-expansion.md`
 * ("Timeline") and the rule in `interval-lanes.ts`'s header.
 */
import { describe, it, expect } from 'vitest';
import { compareLaneItems, packLanes, type LaneItem, type LaneOptions } from '../../../src/shared/objects/interval-lanes';

const item = (key: string, start: number, end = start, title = key): LaneItem => ({ key, start, end, title });
const lanesOf = (items: LaneItem[], opts?: LaneOptions) => Object.fromEntries(packLanes(items, opts).lanes);

/** The rule, written the slow and obvious way: scan lanes from 0. */
function firstFitOracle(items: readonly LaneItem[], opts: LaneOptions = {}): Map<string, number> {
  const minExtent = opts.minExtent ?? 0;
  const gap = opts.gap ?? 0;
  const laneEnds: number[] = [];
  const out = new Map<string, number>();
  for (const it of [...items].sort(compareLaneItems)) {
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = Math.max(it.end, it.start + minExtent) + gap;
    out.set(it.key, lane);
  }
  return out;
}

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('packLanes', () => {
  it('is empty for no items', () => {
    expect(packLanes([])).toEqual({ lanes: new Map(), laneCount: 0, order: [] });
  });

  it('keeps non-overlapping items in lane 0, and touching ones too (half-open)', () => {
    expect(lanesOf([item('a', 0, 10), item('b', 10, 20), item('c', 25, 30)])).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('gives overlapping items separate lanes', () => {
    const p = packLanes([item('a', 0, 10), item('b', 5, 15), item('c', 8, 9)]);
    expect(Object.fromEntries(p.lanes)).toEqual({ a: 0, b: 1, c: 2 });
    expect(p.laneCount).toBe(3);
  });

  it('reuses the lowest free lane, not the one that freed first', () => {
    // Lane 1 frees at 3, lane 0 at 5; at 6 both are free → lane 0.
    expect(lanesOf([item('a', 0, 5), item('b', 1, 3), item('c', 6, 7)])).toEqual({ a: 0, b: 1, c: 0 });
    // At 4 only lane 1 is free.
    expect(lanesOf([item('a', 0, 5), item('b', 1, 3), item('c', 4, 7)])).toEqual({ a: 0, b: 1, c: 1 });
  });

  it('orders by start, then end, then title, then key', () => {
    const items = [item('k3', 0, 9, 'Beta'), item('k1', 0, 5, 'Zed'), item('k2', 0, 9, 'Alpha'), item('k0', 0, 9, 'Alpha'), item('k4', -1, 100, 'Late')];
    expect(packLanes(items).order).toEqual(['k4', 'k1', 'k0', 'k2', 'k3']);
  });

  it('title order is code-unit order, not the viewer’s locale', () => {
    const p = packLanes([item('1', 0, 1, 'b'), item('2', 0, 1, 'B'), item('3', 0, 1, 'á'), item('4', 0, 1, 'a')]);
    expect(p.order).toEqual(['2', '4', '1', '3']);
  });

  it('a point occupies minExtent, so two close points don’t overlap on screen', () => {
    expect(lanesOf([item('a', 100), item('b', 105)])).toEqual({ a: 0, b: 0 });
    expect(lanesOf([item('a', 100), item('b', 105)], { minExtent: 12 })).toEqual({ a: 0, b: 1 });
    expect(lanesOf([item('a', 100), item('b', 112)], { minExtent: 12 })).toEqual({ a: 0, b: 0 });
  });

  it('a gap keeps space after each item in its lane', () => {
    expect(lanesOf([item('a', 0, 10), item('b', 12, 20)], { gap: 4 })).toEqual({ a: 0, b: 1 });
    expect(lanesOf([item('a', 0, 10), item('b', 14, 20)], { gap: 4 })).toEqual({ a: 0, b: 0 });
  });

  it('ignores negative options', () => {
    expect(lanesOf([item('a', 0, 10), item('b', 10, 20)], { gap: -5, minExtent: -1 })).toEqual({ a: 0, b: 0 });
  });

  it('works on negative (BCE) civil ms', () => {
    expect(lanesOf([item('a', -2e13, -1e13), item('b', -1.5e13, 0)])).toEqual({ a: 0, b: 1 });
  });

  it('does not depend on input order', () => {
    const r = rng(7);
    const items = Array.from({ length: 300 }, (_, i) => {
      const s = Math.floor(r() * 1000);
      return item(`n${i}`, s, s + Math.floor(r() * 50), `T${Math.floor(r() * 5)}`);
    });
    const a = packLanes(items);
    const shuffled = [...items].sort(() => r() - 0.5);
    const b = packLanes(shuffled);
    expect(b.order).toEqual(a.order);
    expect(Object.fromEntries(b.lanes)).toEqual(Object.fromEntries(a.lanes));
  });

  it.each([1, 2, 3, 4, 5])('matches first-fit by lane index on random data (seed %i)', (seed) => {
    const r = rng(seed);
    const items = Array.from({ length: 500 }, (_, i) => {
      const s = Math.floor(r() * 2000);
      const point = r() < 0.4;
      return item(`n${i}`, s, point ? s : s + Math.floor(r() * 200), `T${i % 7}`);
    });
    const opts = { minExtent: Math.floor(r() * 20), gap: Math.floor(r() * 4) };
    const p = packLanes(items, opts);
    expect(p.lanes).toEqual(firstFitOracle(items, opts));
    expect(p.laneCount).toBe(Math.max(...p.lanes.values()) + 1);
  });

  it('never puts two overlapping items in one lane', () => {
    const r = rng(42);
    const items = Array.from({ length: 400 }, (_, i) => {
      const s = r() * 1000;
      return item(`n${i}`, s, s + r() * 100);
    });
    const { lanes } = packLanes(items, { minExtent: 3 });
    const byLane = new Map<number, LaneItem[]>();
    for (const it of items) byLane.set(lanes.get(it.key)!, [...(byLane.get(lanes.get(it.key)!) ?? []), it]);
    for (const row of byLane.values()) {
      row.sort((a, b) => a.start - b.start);
      for (let i = 1; i < row.length; i++) expect(row[i]!.start).toBeGreaterThanOrEqual(Math.max(row[i - 1]!.end, row[i - 1]!.start + 3));
    }
  });
});
