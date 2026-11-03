import { describe, it, expect } from 'vitest';
import { STAMP_SETTLE_MS, stampSettled } from '../../src/shared/file-stamp';

describe('stampSettled (#2178)', () => {
  const now = 1_800_000_000_000;

  it('trusts a stamp only once the modification is older than the coarsest tick', () => {
    expect(stampSettled(now - STAMP_SETTLE_MS - 1, now)).toBe(true);
    expect(stampSettled(now - STAMP_SETTLE_MS, now)).toBe(true);
    expect(stampSettled(now - STAMP_SETTLE_MS + 1, now)).toBe(false);
    expect(stampSettled(now, now)).toBe(false);
  });

  it('never trusts a modification time in the future (a skewed clock, a network drive)', () => {
    expect(stampSettled(now + 60_000, now)).toBe(false);
  });

  it('covers FAT\'s two-second steps, the coarsest timestamps in use', () => {
    expect(STAMP_SETTLE_MS).toBeGreaterThanOrEqual(2000);
  });
});
