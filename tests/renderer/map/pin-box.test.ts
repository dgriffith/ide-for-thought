/**
 * Box selection on a map (#2939): the pins whose drawn points fall inside a
 * dragged rectangle, whichever way it was dragged.
 */
import { describe, it, expect } from 'vitest';
import { pinsInBox } from '../../../src/renderer/lib/map/pin-box';

const PINS = [
  { path: 'a.md', x: 10, y: 10 },
  { path: 'b.md', x: 50, y: 40 },
  { path: 'c.md', x: 90, y: 90 },
];

describe('pinsInBox (#2939)', () => {
  it('the pins inside, edges included, in the order given', () => {
    expect(pinsInBox(PINS, { x0: 0, y0: 0, x1: 50, y1: 40 })).toEqual(['a.md', 'b.md']);
  });

  it('the same box dragged from any corner', () => {
    expect(pinsInBox(PINS, { x0: 100, y0: 100, x1: 40, y1: 30 })).toEqual(['b.md', 'c.md']);
    expect(pinsInBox(PINS, { x0: 100, y0: 0, x1: 0, y1: 100 })).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('nothing when the box holds no pin', () => {
    expect(pinsInBox(PINS, { x0: 60, y0: 0, x1: 100, y1: 30 })).toEqual([]);
  });
});
