import { describe, it, expect } from 'vitest';
import { normalizeSqlRows } from '../../../src/renderer/lib/editor/sql-result';

describe('normalizeSqlRows (#234)', () => {
  it('stringifies bigints', () => {
    const rows = normalizeSqlRows(['n'], [{ n: 42n }]);
    expect(rows).toEqual([{ n: '42' }]);
  });

  it('maps null and undefined to empty strings', () => {
    const rows = normalizeSqlRows(['a', 'b'], [{ a: null, b: undefined }]);
    expect(rows).toEqual([{ a: '', b: '' }]);
  });

  it('passes strings through unchanged', () => {
    const rows = normalizeSqlRows(['label'], [{ label: 'Alpha' }]);
    expect(rows).toEqual([{ label: 'Alpha' }]);
  });

  it('stringifies numbers and booleans', () => {
    const rows = normalizeSqlRows(['n', 'flag'], [{ n: 3.14, flag: true }]);
    expect(rows).toEqual([{ n: '3.14', flag: 'true' }]);
  });

  it('ISO-formats Date values', () => {
    const d = new Date('2026-04-22T12:00:00Z');
    const rows = normalizeSqlRows(['t'], [{ t: d }]);
    expect(rows).toEqual([{ t: '2026-04-22T12:00:00.000Z' }]);
  });

  it('preserves column order from the columns array', () => {
    const rows = normalizeSqlRows(
      ['a', 'b', 'c'],
      [{ c: 3, a: 1, b: 2 }],
    );
    expect(Object.keys(rows[0])).toEqual(['a', 'b', 'c']);
  });

  it('tolerates columns missing from a row', () => {
    const rows = normalizeSqlRows(['a', 'b'], [{ a: 'x' }]);
    expect(rows).toEqual([{ a: 'x', b: '' }]);
  });
});
