/**
 * The Week mode's page rules (#2951): the week a month page opens, the month
 * a week opens, "following today" carried across, stepping, and the title.
 */
import { describe, it, expect } from 'vitest';
import { clockLabel, clockRange, monthFromWeek, stepWeek, weekFromMonth, weekTitle } from '../../../plugins/calendar/src/week-nav';
import { timePage } from '../../../src/shared/objects/calendar-grid';
import { civilMs } from '../../../src/shared/objects/date-precision';

const day = (y: number, m: number, d: number) => civilMs(y, m - 1, d);
const TODAY = day(2026, 10, 7);
const norm = (t: string) => t.replace(/\s+/g, ' ');

describe('weekFromMonth', () => {
  const base = { focused: null, today: TODAY, weekStart: 1 as const };

  it('the current month, following today, opens today\'s week unwritten', () => {
    expect(weekFromMonth({ ...base, page: { year: 2026, month: 10 }, followsToday: true })).toEqual({ anchor: TODAY, date: null });
  });

  it('a focused day in the same week as today still follows today; another week is written', () => {
    expect(weekFromMonth({ ...base, page: { year: 2026, month: 10 }, followsToday: true, focused: day(2026, 10, 10) }))
      .toEqual({ anchor: day(2026, 10, 10), date: null });
    expect(weekFromMonth({ ...base, page: { year: 2026, month: 10 }, followsToday: true, focused: day(2026, 10, 20) }))
      .toEqual({ anchor: day(2026, 10, 20), date: '2026-10-20' });
  });

  it('an explicit month is written out: today when it\'s in it, else the 1st; a focused day off the page is ignored', () => {
    expect(weekFromMonth({ ...base, page: { year: 2026, month: 10 }, followsToday: false })).toEqual({ anchor: TODAY, date: '2026-10-07' });
    expect(weekFromMonth({ ...base, page: { year: 2026, month: 12 }, followsToday: false, focused: day(2026, 10, 20) }))
      .toEqual({ anchor: day(2026, 12, 1), date: '2026-12-01' });
    expect(weekFromMonth({ ...base, page: { year: -43, month: 3 }, followsToday: false })).toEqual({ anchor: day(-43, 3, 1), date: '-0043-03-01' });
  });

  it('judges "the same week" by the viewer\'s week start', () => {
    // Sunday 11 October is in today's Monday-start week, but not in a Sunday-start one.
    const sunday = { ...base, page: { year: 2026, month: 10 }, followsToday: true, focused: day(2026, 10, 11) };
    expect(weekFromMonth(sunday).date).toBeNull();
    expect(weekFromMonth({ ...sunday, weekStart: 7 }).date).toBe('2026-10-11');
  });
});

describe('monthFromWeek / stepWeek', () => {
  it('follows today, or writes the anchor\'s month', () => {
    expect(monthFromWeek({ anchor: TODAY, followsToday: true })).toBeNull();
    expect(monthFromWeek({ anchor: day(2026, 12, 30), followsToday: false })).toBe('2026-12');
  });

  it('steps whole weeks, across years', () => {
    expect(stepWeek(TODAY, 1)).toBe(day(2026, 10, 14));
    expect(stepWeek(day(2026, 12, 30), 1)).toBe(day(2027, 1, 6));
    expect(stepWeek(TODAY, -2)).toBe(day(2026, 9, 23));
  });
});

describe('weekTitle / clockLabel', () => {
  it('ranges within a month, across months and across years, with the week number', () => {
    expect(norm(weekTitle(timePage(TODAY, 'week', 1), 'en-GB'))).toBe('5 – 11 October 2026');
    expect(norm(weekTitle(timePage(day(2026, 10, 1), 'week', 1), 'en-GB'))).toBe('28 September – 4 October 2026');
    expect(norm(weekTitle(timePage(day(2026, 12, 30), 'week', 1), 'en-GB', 53))).toBe('Week 53 · 28 December 2026 – 3 January 2027');
    expect(norm(weekTitle(timePage(TODAY, 'week', 7), 'en-US'))).toBe('October 4 – 10, 2026');
  });

  it('a time of day in the locale', () => {
    expect(clockLabel(9 * 60 + 30, 'en-GB')).toBe('9:30');
    expect(norm(clockLabel(13 * 60, 'en-US'))).toBe('1:00 PM');
    // A range says AM/PM once where the locale does.
    expect(norm(clockRange(9 * 60, 11 * 60, 'en-US'))).toBe('9:00 – 11:00 AM');
    expect(norm(clockRange(11 * 60, 13 * 60, 'en-US'))).toBe('11:00 AM – 1:00 PM');
    expect(norm(clockRange(22 * 60, 24 * 60, 'en-US'))).toBe('10:00 PM – 12:00 AM');
  });
});
