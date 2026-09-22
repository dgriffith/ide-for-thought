import { describe, it, expect } from 'vitest';
import { coerceDuckBigInt, coerceDuckRowsForIpc } from '../../../src/main/compute/duck-values';

describe('coerceDuckBigInt', () => {
  it('keeps small positive integers as numbers', () => {
    const out = coerceDuckBigInt(42n);
    expect(out).toBe(42);
    expect(typeof out).toBe('number');
  });

  it('keeps negative integers as numbers', () => {
    expect(coerceDuckBigInt(-7n)).toBe(-7);
  });

  it('keeps zero as a number', () => {
    expect(coerceDuckBigInt(0n)).toBe(0);
  });

  it('keeps MAX_SAFE_INTEGER numeric (boundary is inclusive)', () => {
    const out = coerceDuckBigInt(BigInt(Number.MAX_SAFE_INTEGER));
    expect(out).toBe(Number.MAX_SAFE_INTEGER);
    expect(typeof out).toBe('number');
  });

  it('keeps MIN_SAFE_INTEGER numeric (boundary is inclusive)', () => {
    const out = coerceDuckBigInt(BigInt(Number.MIN_SAFE_INTEGER));
    expect(out).toBe(Number.MIN_SAFE_INTEGER);
    expect(typeof out).toBe('number');
  });

  it('falls back to a decimal string one past the safe-integer ceiling', () => {
    const v = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const out = coerceDuckBigInt(v);
    expect(out).toBe('9007199254740992');
    expect(typeof out).toBe('string');
  });

  it('falls back to a decimal string one past the safe-integer floor', () => {
    const v = BigInt(Number.MIN_SAFE_INTEGER) - 1n;
    expect(coerceDuckBigInt(v)).toBe('-9007199254740992');
  });

  it('preserves full precision of a 64-bit max value as a string', () => {
    expect(coerceDuckBigInt(9223372036854775807n)).toBe('9223372036854775807');
  });
});

describe('coerceDuckRowsForIpc (#2228)', () => {
  it('makes a row set with an integer column JSON-serializable', () => {
    // The named gate: this is what `JSON.stringify` does to a raw DuckDB
    // result, and what it must stop doing once the rows cross TABLES_QUERY.
    const raw = [{ id: 1n, name: 'alpha' }, { id: 2n, name: 'beta' }];
    expect(() => JSON.stringify(raw)).toThrow(/BigInt/);
    const coerced = coerceDuckRowsForIpc(raw);
    expect(JSON.parse(JSON.stringify(coerced))).toEqual([
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
    ]);
  });

  it('keeps an in-range integer numeric rather than stringifying it', () => {
    // A chart binding scales on this value and the results table sorts on it;
    // a string column would be a silently different (nominal) axis.
    const [row] = coerceDuckRowsForIpc([{ n: 42n }]);
    expect(row!.n).toBe(42);
    expect(typeof row!.n).toBe('number');
  });

  it('falls back to a decimal string past the safe-integer range', () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(coerceDuckRowsForIpc([{ n: big }])[0]!.n).toBe('9007199254740992');
  });

  it('passes non-bigint values through untouched, Dates included', () => {
    const when = new Date('2024-03-01T00:00:00.000Z');
    const row = { s: 'x', f: 1.5, b: true, nil: null, when, nested: { a: 1 } };
    const [out] = coerceDuckRowsForIpc([row]);
    expect(out).toEqual(row);
    expect(out!.when).toBe(when);
  });

  it('returns a bigint-free row by reference instead of rebuilding it', () => {
    // Cheap-path check: the coercion runs over every TABLES_QUERY result, so a
    // string-only table must not pay a full object rebuild per row.
    const row = { a: 'x' };
    expect(coerceDuckRowsForIpc([row])[0]).toBe(row);
  });

  it('handles an empty result set', () => {
    expect(coerceDuckRowsForIpc([])).toEqual([]);
  });
});
