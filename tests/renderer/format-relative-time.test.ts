/**
 * Compact relative-time stamp shown on sidebar file rows (#546).
 * Verifies each bucket boundary and the rounding behaviour.
 */

import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../../src/renderer/lib/utils/format-relative-time';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

describe('formatRelativeTime', () => {
  const NOW = 1_700_000_000_000; // arbitrary reference

  it('returns "now" for sub-minute deltas', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('now');
    expect(formatRelativeTime(NOW - 59 * SEC, NOW)).toBe('now');
  });

  it('rounds down to the nearest unit', () => {
    expect(formatRelativeTime(NOW - MIN, NOW)).toBe('1m');
    expect(formatRelativeTime(NOW - 59 * MIN, NOW)).toBe('59m');
    expect(formatRelativeTime(NOW - 2 * HOUR, NOW)).toBe('2h');
    expect(formatRelativeTime(NOW - 23 * HOUR, NOW)).toBe('23h');
    expect(formatRelativeTime(NOW - 5 * DAY, NOW)).toBe('5d');
    expect(formatRelativeTime(NOW - 6 * DAY - 23 * HOUR, NOW)).toBe('6d');
    expect(formatRelativeTime(NOW - 2 * WEEK, NOW)).toBe('2w');
    expect(formatRelativeTime(NOW - 3 * MONTH, NOW)).toBe('3mo');
    expect(formatRelativeTime(NOW - 2 * YEAR, NOW)).toBe('2y');
  });

  it('clamps negative deltas to "now"', () => {
    // Disk mtime newer than wall clock (clock skew, future-dated files)
    expect(formatRelativeTime(NOW + DAY, NOW)).toBe('now');
  });
});
