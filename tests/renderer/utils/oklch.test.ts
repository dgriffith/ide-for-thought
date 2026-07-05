/**
 * oklch() → sRGB hex conversion (theme tokens fed to mermaid's khroma, which
 * can't parse oklch()). Reference values computed from Björn Ottosson's OKLab
 * math; the achromatic anchors (#000000 / #ffffff) are exact by construction.
 */
import { describe, it, expect } from 'vitest';
import { normalizeColor, oklchToHex } from '../../../src/renderer/lib/utils/oklch';

describe('oklchToHex', () => {
  it('maps achromatic lightness endpoints to black and white', () => {
    expect(oklchToHex(0, 0, 0)).toBe('#000000');
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff');
  });

  it('converts real theme tokens to their sRGB hex', () => {
    expect(oklchToHex(0.285, 0.014, 70)).toBe('#2f2923'); // --bg-elev-2 (the reported error value)
    expect(oklchToHex(0.205, 0.012, 70)).toBe('#1b1611'); // --bg
    expect(oklchToHex(0.925, 0.018, 85)).toBe('#ece6d9'); // --text
    expect(oklchToHex(0.79, 0.115, 78)).toBe('#e3b160'); // --accent
  });

  it('clamps out-of-sRGB-gamut results into range', () => {
    expect(oklchToHex(0.7, 0.4, 30)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('normalizeColor', () => {
  it('converts the exact oklch string that broke mermaid', () => {
    expect(normalizeColor('oklch(0.285 0.014 70)')).toBe('#2f2923');
  });

  it('accepts percentage lightness and an optional deg hue / alpha', () => {
    expect(normalizeColor('oklch(100% 0 0)')).toBe('#ffffff');
    expect(normalizeColor('oklch(0% 0 0)')).toBe('#000000');
    expect(normalizeColor('oklch(0.285 0.014 70deg)')).toBe('#2f2923');
    expect(normalizeColor('oklch(0.285 0.014 70 / 0.5)')).toBe('#2f2923');
  });

  it('passes non-oklch colors through untouched', () => {
    expect(normalizeColor('#3a3a4a')).toBe('#3a3a4a');
    expect(normalizeColor('rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)');
    expect(normalizeColor('rebeccapurple')).toBe('rebeccapurple');
    expect(normalizeColor('')).toBe('');
  });
});
