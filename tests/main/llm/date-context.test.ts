/**
 * The conversation system prompt injects today's date so the model dates notes
 * correctly and can resolve relative dates (#1138). This pins the format and
 * the per-turn / timezone behavior of `currentDateContext`.
 */
import { describe, it, expect } from 'vitest';
import { currentDateContext } from '../../../src/main/llm/date-context';

describe('currentDateContext (#1138)', () => {
  it('formats weekday, ISO date, and timezone for a fixed instant', () => {
    // 2026-07-10 12:00 UTC → 07:00 in Chicago (CDT, UTC-5), still July 10.
    const line = currentDateContext(new Date('2026-07-10T12:00:00Z'), 'America/Chicago');
    expect(line).toBe(
      "Today's date is Friday, 2026-07-10 (America/Chicago). Use it to resolve " +
        'relative dates ("today", "tomorrow", "last week") and whenever you name or date a note.',
    );
  });

  it('resolves the calendar date in the given timezone, not UTC', () => {
    // 23:30 UTC on the 10th is already the 11th in Tokyo (UTC+9).
    const instant = new Date('2026-07-10T23:30:00Z');
    expect(currentDateContext(instant, 'Asia/Tokyo')).toContain('2026-07-11');
    expect(currentDateContext(instant, 'America/Chicago')).toContain('2026-07-10');
  });

  it('names the timezone it was given', () => {
    expect(currentDateContext(new Date('2026-01-02T12:00:00Z'), 'Europe/London')).toContain(
      '(Europe/London)',
    );
  });
});
