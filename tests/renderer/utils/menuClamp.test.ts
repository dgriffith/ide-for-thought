/**
 * chooseSubmenuSide — the geometry behind submenu left/right flipping, with
 * room reserved for a nested level and cascade-direction inheritance so deep
 * menus near the right edge don't clip or zig-zag.
 */

import { describe, it, expect } from 'vitest';
import { chooseSubmenuSide } from '../../../src/renderer/lib/utils/menuClamp';

const base = {
  itemLeft: 0,
  itemRight: 0,
  submenuWidth: 150,
  viewportWidth: 1000,
  inheritLeft: false,
  hasNested: false,
};

describe('chooseSubmenuSide', () => {
  it('opens right by default when there is room', () => {
    expect(chooseSubmenuSide({ ...base, itemLeft: 100, itemRight: 200 })).toBe(false);
  });

  it('flips left near the right edge when the right overflows and the left fits', () => {
    expect(chooseSubmenuSide({ ...base, itemLeft: 800, itemRight: 900 })).toBe(true);
  });

  it('reserves room for a nested level: a leaf opens right but a parent-of-submenu flips left', () => {
    // Same geometry: the leaf fits on the right, but reserving a second
    // same-width level pushes a nested-containing submenu to the left.
    const geom = { ...base, itemLeft: 700, itemRight: 800 };
    expect(chooseSubmenuSide({ ...geom, hasNested: false })).toBe(false);
    expect(chooseSubmenuSide({ ...geom, hasNested: true })).toBe(true);
  });

  it('inherits a leftward cascade: stays left even when the right would fit', () => {
    expect(chooseSubmenuSide({ ...base, itemLeft: 500, itemRight: 600, inheritLeft: true })).toBe(true);
  });

  it('an inherited-left chain falls back to right when the left cannot hold it', () => {
    expect(chooseSubmenuSide({ ...base, itemLeft: 100, itemRight: 200, inheritLeft: true })).toBe(false);
  });

  it('default chains stay right when the left also cannot fit (clamped elsewhere)', () => {
    // Cramped viewport: neither side fits; a non-inherited chain keeps the
    // default right side rather than flipping into an equally-bad left.
    expect(chooseSubmenuSide({
      ...base, itemLeft: 80, itemRight: 120, viewportWidth: 200,
    })).toBe(false);
  });
});
