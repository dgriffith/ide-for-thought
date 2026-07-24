import { describe, it, expect } from 'vitest';
import { coerceDuckBigInt } from '../../../src/main/compute/duck-values';

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
