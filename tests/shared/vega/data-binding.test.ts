/**
 * Vega data-binding resolution layer (#832 pt 1 / #880).
 *
 * The pure core: detect a Minerva data form, normalize/coerce rows, and resolve
 * to inline `data.values` via an injected executor. Locks the contract the
 * renderer (#882) and export (#885) paths both build on.
 */

import { describe, it, expect } from 'vitest';
import {
  detectDataSource,
  rowsFromTable,
  coerceRows,
  resolveVegaData,
  type DataSourceRef,
} from '../../../src/shared/vega/data-binding';

describe('detectDataSource', () => {
  it('detects each Minerva data form', () => {
    expect(detectDataSource({ data: { sparql: 'SELECT 1' } })).toEqual({ kind: 'sparql', query: 'SELECT 1' });
    expect(detectDataSource({ data: { sql: 'SELECT 1' } })).toEqual({ kind: 'sql', query: 'SELECT 1' });
    expect(detectDataSource({ data: { table: 'sales' } })).toEqual({ kind: 'table', name: 'sales' });
    expect(detectDataSource({ data: { cell: 'a1b2c3d4' } })).toEqual({ kind: 'cell', id: 'a1b2c3d4' });
  });

  it('returns null for plain inline values, a url, or a full-Vega data array', () => {
    expect(detectDataSource({ data: { values: [{ a: 1 }] } })).toBeNull();
    expect(detectDataSource({ data: { url: 'https://x/y.csv' } })).toBeNull();
    expect(detectDataSource({ data: [{ name: 't', values: [] }] })).toBeNull(); // full vega
    expect(detectDataSource({ mark: 'bar' })).toBeNull(); // no data
    expect(detectDataSource(null)).toBeNull();
    expect(detectDataSource('nope')).toBeNull();
  });

  it('ignores a non-string source value', () => {
    expect(detectDataSource({ data: { sparql: 123 } })).toBeNull();
  });
});

describe('rowsFromTable', () => {
  it('zips column-ordered rows into objects', () => {
    expect(rowsFromTable(['a', 'b'], [[1, 'x'], [2, 'y']])).toEqual([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]);
  });

  it('fills missing cells with null', () => {
    expect(rowsFromTable(['a', 'b'], [[1]])).toEqual([{ a: 1, b: null }]);
  });
});

describe('coerceRows', () => {
  it('converts an all-numeric-string column to numbers (the SPARQL case)', () => {
    const rows = [{ x: 'A', y: '10' }, { x: 'B', y: '25' }];
    expect(coerceRows(rows)).toEqual([{ x: 'A', y: 10 }, { x: 'B', y: 25 }]);
  });

  it('leaves a column with any non-numeric value as strings', () => {
    const rows = [{ y: '10' }, { y: 'n/a' }];
    expect(coerceRows(rows)).toEqual([{ y: '10' }, { y: 'n/a' }]);
  });

  it('does not turn dates into numbers', () => {
    const rows = [{ d: '2024-01-01', v: '5' }, { d: '2024-02-01', v: '8' }];
    expect(coerceRows(rows)).toEqual([{ d: '2024-01-01', v: 5 }, { d: '2024-02-01', v: 8 }]);
  });

  it('treats empty strings as absent, not as 0', () => {
    const rows = [{ y: '10' }, { y: '' }, { y: '30' }];
    // Column is "all numeric where present" → present values coerce, blanks stay.
    expect(coerceRows(rows)).toEqual([{ y: 10 }, { y: '' }, { y: 30 }]);
  });

  it('handles empty input', () => {
    expect(coerceRows([])).toEqual([]);
  });
});

describe('resolveVegaData', () => {
  it('replaces a bound data form with inline coerced values', async () => {
    const spec = { mark: 'bar', data: { sparql: 'SELECT ?x ?y …' }, encoding: {} };
    const ref: DataSourceRef = { kind: 'sparql', query: 'SELECT ?x ?y …' };
    const exec = async () => [{ x: 'A', y: '10' }, { x: 'B', y: '20' }];
    const out = await resolveVegaData(spec, ref, exec);
    expect(out.data).toEqual({ values: [{ x: 'A', y: 10 }, { x: 'B', y: 20 }] });
    expect(out.mark).toBe('bar'); // rest of the spec preserved
  });

  it('propagates an executor error (caller renders it inline)', async () => {
    const exec = async () => { throw new Error('SPARQL parse error'); };
    await expect(
      resolveVegaData({ data: { sparql: 'BAD' } }, { kind: 'sparql', query: 'BAD' }, exec),
    ).rejects.toThrow('SPARQL parse error');
  });
});
