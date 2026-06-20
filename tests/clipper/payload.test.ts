/**
 * Selection normalisation for the clip payload (#792).
 */

import { describe, it, expect } from 'vitest';
import { normalizeSelection } from '../../clipper/src/payload';

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
