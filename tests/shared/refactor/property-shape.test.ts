import { describe, it, expect } from 'vitest';
import {
  SCALAR_TYPES,
  isScalarType,
  coerceScalar,
  scalarToText,
  isValidScalar,
} from '../../../src/shared/refactor/property-shape';

describe('isScalarType', () => {
  it('accepts the four scalar kinds and rejects richer shapes', () => {
    for (const t of SCALAR_TYPES) expect(isScalarType(t)).toBe(true);
    expect(isScalarType('string-list')).toBe(false);
    expect(isScalarType('wiki-link')).toBe(false);
    expect(isScalarType('yaml')).toBe(false);
  });
});

describe('coerceScalar', () => {
  it('string keeps the text verbatim (including surrounding spaces)', () => {
    expect(coerceScalar('string', '  keep me ')).toBe('  keep me ');
  });

  it('number parses, falling back to 0 on non-numeric or empty', () => {
    expect(coerceScalar('number', '42')).toBe(42);
    expect(coerceScalar('number', '3.5')).toBe(3.5);
    expect(coerceScalar('number', '')).toBe(0);
    expect(coerceScalar('number', 'nope')).toBe(0);
  });

  it('boolean is true only for true/yes/on/1 (case-insensitive)', () => {
    for (const t of ['true', 'TRUE', 'yes', 'on', '1']) {
      expect(coerceScalar('boolean', t)).toBe(true);
    }
    for (const f of ['false', 'no', 'off', '0', '', 'anything']) {
      expect(coerceScalar('boolean', f)).toBe(false);
    }
  });

  it('date keeps a YYYY-MM-DD value and drops anything else', () => {
    expect(coerceScalar('date', '2026-07-21')).toBe('2026-07-21');
    expect(coerceScalar('date', 'not-a-date')).toBe('');
  });
});

describe('scalarToText', () => {
  it('stringifies primitives and empties out objects/null', () => {
    expect(scalarToText(true)).toBe('true');
    expect(scalarToText(false)).toBe('false');
    expect(scalarToText(42)).toBe('42');
    expect(scalarToText('hi')).toBe('hi');
    expect(scalarToText(null)).toBe('');
    expect(scalarToText({})).toBe('');
  });
});

describe('isValidScalar', () => {
  it('only gates number, requiring a finite value', () => {
    expect(isValidScalar('number', '10')).toBe(true);
    expect(isValidScalar('number', '')).toBe(false);
    expect(isValidScalar('number', 'x')).toBe(false);
    expect(isValidScalar('string', '')).toBe(true);
    expect(isValidScalar('boolean', '')).toBe(true);
    expect(isValidScalar('date', '')).toBe(true);
  });
});
