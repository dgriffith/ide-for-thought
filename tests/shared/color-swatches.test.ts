/**
 * Colour-swatch palette + hex normalization for the type editor's colour
 * picker. `toHex6` is what stands between a hand-typed colour and
 * `<input type="color">`, which silently ignores anything that isn't #rrggbb.
 */
import { describe, it, expect } from 'vitest';
import { COLOR_SWATCHES, DEFAULT_SWATCH, toHex6 } from '../../src/shared/color-swatches';

describe('COLOR_SWATCHES', () => {
  it('is all lowercase #rrggbb, so a swatch compares equal to a normalized field', () => {
    for (const sw of COLOR_SWATCHES) {
      expect(sw.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(toHex6(sw.hex)).toBe(sw.hex);
    }
  });

  it('has no duplicate colours or names', () => {
    expect(new Set(COLOR_SWATCHES.map((s) => s.hex)).size).toBe(COLOR_SWATCHES.length);
    expect(new Set(COLOR_SWATCHES.map((s) => s.name)).size).toBe(COLOR_SWATCHES.length);
  });

  it('offers the default swatch as a pickable colour', () => {
    expect(COLOR_SWATCHES.some((s) => s.hex === DEFAULT_SWATCH)).toBe(true);
  });
});

describe('toHex6', () => {
  it('passes through a full hex, lowercasing it', () => {
    expect(toHex6('#89B4FA')).toBe('#89b4fa');
    expect(toHex6('#89b4fa')).toBe('#89b4fa');
  });

  it('expands the #rgb shorthand', () => {
    expect(toHex6('#fff')).toBe('#ffffff');
    expect(toHex6('#0a3')).toBe('#00aa33');
  });

  it('tolerates whitespace and a missing #', () => {
    expect(toHex6('  #89b4fa  ')).toBe('#89b4fa');
    expect(toHex6('89b4fa')).toBe('#89b4fa');
  });

  it('returns null for anything it cannot parse — including a half-typed hex', () => {
    // The half-typed case is the one that matters: the well must hold its last
    // good value rather than blanking on every keystroke.
    expect(toHex6('#89b4f')).toBeNull();
    expect(toHex6('')).toBeNull();
    expect(toHex6('rebeccapurple')).toBeNull();
    expect(toHex6('#gggggg')).toBeNull();
    expect(toHex6('#89b4fa80')).toBeNull(); // 8-digit alpha hex
  });
});
