import { describe, it, expect } from 'vitest';
import {
  MIN_FONT,
  MAX_FONT,
  DEFAULT_FONT,
  clampFontSize,
  parseStoredFontSize,
} from '../../src/renderer/lib/editor/font-size';

describe('clampFontSize', () => {
  it('keeps an in-range size unchanged', () => {
    expect(clampFontSize(14)).toBe(14);
    expect(clampFontSize(MIN_FONT)).toBe(MIN_FONT);
    expect(clampFontSize(MAX_FONT)).toBe(MAX_FONT);
  });

  it('clamps below MIN and above MAX', () => {
    expect(clampFontSize(MIN_FONT - 5)).toBe(MIN_FONT);
    expect(clampFontSize(MAX_FONT + 100)).toBe(MAX_FONT);
  });

  it('models the +/- step behavior at the boundaries', () => {
    // changeFontSize(delta) does clampFontSize(current + delta).
    expect(clampFontSize(MAX_FONT + 2)).toBe(MAX_FONT); // can't grow past max
    expect(clampFontSize(MIN_FONT - 2)).toBe(MIN_FONT); // can't shrink past min
  });
});

describe('parseStoredFontSize', () => {
  it('falls back to DEFAULT_FONT when nothing is stored', () => {
    expect(parseStoredFontSize(null)).toBe(DEFAULT_FONT);
  });

  it('parses a stored numeric string', () => {
    expect(parseStoredFontSize('18')).toBe(18);
    expect(parseStoredFontSize('10')).toBe(MIN_FONT);
  });

  it('parses a leading-numeric value the way parseInt does', () => {
    expect(parseStoredFontSize('16px')).toBe(16);
  });
});
