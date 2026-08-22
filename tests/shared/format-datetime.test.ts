/**
 * Absolute date+time stamps (#1158). A revision timeline needs to distinguish
 * two versions saved minutes apart, so these always carry a date and a
 * to-the-minute time — never a relative "now" / "1m".
 */
import { describe, it, expect } from 'vitest';
import { formatDateTime } from '../../src/shared/format-datetime';

describe('formatDateTime', () => {
  const aug22 = new Date(2026, 7, 22, 14, 7).getTime();

  it('shows the date and the time to the minute', () => {
    const out = formatDateTime(aug22, aug22);
    expect(out).toMatch(/22/);
    expect(out).toMatch(/\d{1,2}:07/);
  });

  it('never collapses to a relative stamp, however recent', () => {
    expect(formatDateTime(aug22, aug22 + 30_000)).toBe(formatDateTime(aug22, aug22));
  });

  it('adds the year only when it differs from the current one', () => {
    const now = new Date(2026, 7, 22, 14, 7).getTime();
    expect(formatDateTime(aug22, now)).not.toMatch(/2026/);
    expect(formatDateTime(new Date(2025, 7, 22, 14, 7).getTime(), now)).toMatch(/2025/);
  });
});
