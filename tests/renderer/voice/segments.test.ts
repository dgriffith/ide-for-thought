import { describe, it, expect } from 'vitest';
import { planSegments } from '../../../src/renderer/lib/voice/segments';

const RATE = 100; // 100 samples/s keeps the arrays small and the arithmetic legible

/** `seconds` of constant "speech" at amplitude 0.5. */
function tone(seconds: number): Float32Array {
  return new Float32Array(seconds * RATE).fill(0.5);
}

function expectContiguous(ranges: readonly (readonly [number, number])[], total: number): void {
  expect(ranges[0]![0]).toBe(0);
  expect(ranges.at(-1)![1]).toBe(total);
  for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1]);
  for (const [a, b] of ranges) expect(b).toBeGreaterThan(a);
}

describe('planSegments', () => {
  it('returns nothing for an empty recording', () => {
    expect(planSegments(new Float32Array(0), RATE)).toEqual([]);
  });

  it('keeps a short recording as one segment', () => {
    const s = tone(30);
    expect(planSegments(s, RATE, { targetSec: 120 })).toEqual([[0, s.length]]);
  });

  it('does not leave a sliver: up to 1.5x the target stays whole', () => {
    const s = tone(170);
    expect(planSegments(s, RATE, { targetSec: 120 })).toHaveLength(1);
  });

  it('covers a long recording with contiguous segments near the target length', () => {
    const s = tone(60 * 60); // an hour
    const ranges = planSegments(s, RATE, { targetSec: 120, searchSec: 10 });
    expectContiguous(ranges, s.length);
    expect(ranges.length).toBeGreaterThanOrEqual(25);
    for (const [a, b] of ranges.slice(0, -1)) {
      const sec = (b - a) / RATE;
      expect(sec).toBeGreaterThanOrEqual(110);
      expect(sec).toBeLessThanOrEqual(130);
    }
  });

  it('moves each cut onto a pause near the target', () => {
    const s = tone(400);
    // Pauses at 115s and 237s — within ±10s of the 120s and 240s targets.
    s.fill(0, 115 * RATE, 115 * RATE + 20);
    s.fill(0, 237 * RATE, 237 * RATE + 20);
    const ranges = planSegments(s, RATE, { targetSec: 120, searchSec: 10, windowMs: 100 });
    expectContiguous(ranges, s.length);
    const cuts = ranges.slice(0, -1).map(([, b]) => b / RATE);
    expect(cuts[0]).toBeCloseTo(115.1, 0);
    expect(cuts[1]).toBeCloseTo(237.1, 0);
  });

  it('ignores a pause outside the search window', () => {
    const s = tone(300);
    s.fill(0, 60 * RATE, 61 * RATE); // a pause, but 60s from the 120s target
    const ranges = planSegments(s, RATE, { targetSec: 120, searchSec: 10 });
    const firstCut = ranges[0]![1] / RATE;
    expect(firstCut).toBeGreaterThanOrEqual(110);
    expect(firstCut).toBeLessThanOrEqual(130);
  });

  it('cuts at the target, not the edge of the search, through uniform silence', () => {
    const s = new Float32Array(400 * RATE);
    const ranges = planSegments(s, RATE, { targetSec: 120, searchSec: 10 });
    expect(ranges[0]![1]).toBe(120 * RATE);
  });
});
