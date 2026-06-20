/**
 * Selection normalisation for the clip payload (#792).
 */

import { describe, it, expect } from 'vitest';
import { normalizeSelection, parseTags } from '../../clipper/src/payload';

describe('normalizeSelection', () => {
  it('trims a real selection', () => {
    expect(normalizeSelection('  a quote  ')).toBe('a quote');
  });

  it('returns undefined for empty / whitespace / nullish', () => {
    expect(normalizeSelection('')).toBeUndefined();
    expect(normalizeSelection('   \n ')).toBeUndefined();
    expect(normalizeSelection(null)).toBeUndefined();
    expect(normalizeSelection(undefined)).toBeUndefined();
  });
});

describe('parseTags', () => {
  it('splits on commas and whitespace, strips #, de-dupes', () => {
    expect(parseTags('ai, #papers  ml,ai')).toEqual(['ai', 'papers', 'ml']);
  });

  it('returns an empty list for blank / nullish input', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags('  ,  ')).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });
});
