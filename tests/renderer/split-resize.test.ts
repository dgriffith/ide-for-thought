/**
 * Divider-drag size redistribution for SplitContainer (#813).
 */
import { describe, it, expect } from 'vitest';
import { redistributeSizes } from '../../src/renderer/lib/editor/split-resize';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('redistributeSizes', () => {
  it('moves the boundary between the two adjacent panes only', () => {
    const next = redistributeSizes([0.5, 0.5], 0, 0.1, 0.05);
    expect(next).toEqual([0.6, 0.4]);
  });

  it('leaves non-adjacent panes untouched and conserves the pair total', () => {
    const next = redistributeSizes([0.25, 0.25, 0.5], 0, 0.1, 0.05);
    expect(next[2]).toBe(0.5); // third pane unchanged
    expect(next[0] + next[1]).toBeCloseTo(0.5, 6); // pair total conserved
    expect(sum(next)).toBeCloseTo(1, 6);
  });

  it('clamps the shrinking pane to the minimum', () => {
    // Dragging far left would drive pane 0 below min; it stops at min.
    const next = redistributeSizes([0.5, 0.5], 0, -0.9, 0.1);
    expect(next[0]).toBeCloseTo(0.1, 6);
    expect(next[1]).toBeCloseTo(0.9, 6);
  });

  it('clamps the growing pane so its sibling keeps the minimum', () => {
    const next = redistributeSizes([0.5, 0.5], 0, 0.9, 0.1);
    expect(next[0]).toBeCloseTo(0.9, 6);
    expect(next[1]).toBeCloseTo(0.1, 6);
  });

  it('is a no-op for an out-of-range boundary index', () => {
    expect(redistributeSizes([0.5, 0.5], 1, 0.1, 0.05)).toEqual([0.5, 0.5]);
    expect(redistributeSizes([1], 0, 0.1, 0.05)).toEqual([1]);
  });

  it('handles a zero delta as identity', () => {
    expect(redistributeSizes([0.3, 0.7], 0, 0, 0.05)).toEqual([0.3, 0.7]);
  });
});
