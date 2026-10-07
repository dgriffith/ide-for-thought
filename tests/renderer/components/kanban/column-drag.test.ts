/**
 * Column drag geometry (#2614): where a dragged header lands, given the
 * visible columns' edges and the pointer — and that a drop that wouldn't move
 * anything is no drop.
 */
import { describe, it, expect } from 'vitest';
import { planColumnDrop } from '../../../../src/renderer/lib/components/kanban/column-drag';

// Three 100px columns with 10px gaps: a [0,100], b [110,210], c [220,320].
const rects = [
  { key: 'a', left: 0, right: 100 },
  { key: 'b', left: 110, right: 210 },
  { key: 'c', left: 220, right: 320 },
];

describe('planColumnDrop', () => {
  it('drops before the first column whose midpoint is right of the pointer', () => {
    expect(planColumnDrop(rects, 2, 40)).toEqual({ target: 'a', side: 'before' });
    expect(planColumnDrop(rects, 0, 200)).toEqual({ target: 'c', side: 'before' });
  });

  it('past the last midpoint, drops after the last column', () => {
    expect(planColumnDrop(rects, 0, 300)).toEqual({ target: 'c', side: 'after' });
    expect(planColumnDrop(rects, 0, 900)).toEqual({ target: 'c', side: 'after' });
  });

  it('is null where the column already is — either side of itself', () => {
    expect(planColumnDrop(rects, 1, 100)).toBeNull(); // before b
    expect(planColumnDrop(rects, 1, 200)).toBeNull(); // after b, before c's midpoint
    expect(planColumnDrop(rects, 2, 900)).toBeNull(); // after c, which is c
  });

  it('is null with fewer than two columns or an unknown dragged column', () => {
    expect(planColumnDrop(rects.slice(0, 1), 0, 500)).toBeNull();
    expect(planColumnDrop(rects, -1, 40)).toBeNull();
  });
});
