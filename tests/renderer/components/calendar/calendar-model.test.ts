/**
 * The Calendar's model (#2702): placement by the start's precision, a page's
 * bands with since/until, a day's list in the cell's order, local times, and
 * "written as" for an offset value shown on another day (decision 7).
 */
import { describe, it, expect } from 'vitest';
import { buildCalendarModel, dayEvents, monthTitle, pageBands, timeOf, writtenAs, yearName } from '../../../../src/renderer/lib/components/calendar/calendar-model';
import { civilMs } from '../../../../src/shared/objects/date-precision';
import type { TypeInstanceRow } from '../../../../src/shared/objects/type-def';

const row = (path: string, date: string | null, end: string | null = null): TypeInstanceRow =>
  ({ path, title: path.replace('.md', ''), values: { date, end }, cover: null });
const PROPS = { dateProperty: 'date', endProperty: 'end', locale: 'en-GB' };

describe('buildCalendarModel', () => {
  it('places by the start\'s precision, and sends the rest to Undated', () => {
    const m = buildCalendarModel([
      row('day.md', '2026-10-06'), row('clock.md', '2026-10-06T09:30'), row('month.md', '2026-10'),
      row('year.md', '2026'), row('none.md', null), row('far.md', '100000'),
    ], PROPS);
    expect(m.grid.map((e) => e.key)).toEqual(['day.md', 'clock.md']);
    expect(m.month.map((e) => e.key)).toEqual(['month.md']);
    expect(m.year.map((e) => e.key)).toEqual(['year.md']);
    expect(m.undated.map((u) => [u.key, u.reasonText])).toEqual([
      ['none.md', 'No date'],
      ['far.md', "Outside the calendar's range (100000)"],
    ]);
  });
});

describe('pageBands', () => {
  const m = buildCalendarModel([row('jul-sep.md', '1969-07', '1969-09'), row('sixties.md', '1960', '1969'), row('bce.md', '-0043')], PROPS);

  it('lists a month-precision range on each page it meets, since/until where it runs past', () => {
    const at = (month: number) => pageBands(m, { year: 1969, month }, 'en-GB').month.map((b) => [b.ev.key, b.since, b.until]);
    expect(at(6)).toEqual([]);
    expect(at(7)).toEqual([['jul-sep.md', null, 'until September']]);
    expect(at(8)).toEqual([['jul-sep.md', 'since July', 'until September']]);
    expect(at(9)).toEqual([['jul-sep.md', 'since July', null]]);
  });

  it('names the year when a neighbouring month is in another year', () => {
    const w = buildCalendarModel([row('winter.md', '2025-12', '2026-02')], PROPS);
    expect(pageBands(w, { year: 2026, month: 1 }, 'en-GB').month[0]).toMatchObject({ since: 'since December 2025', until: 'until February' });
  });

  it('lists a year-precision range on every month of its years, since/until by year', () => {
    expect(pageBands(m, { year: 1965, month: 3 }, 'en-GB').year.map((b) => [b.ev.key, b.since, b.until])).toEqual([['sixties.md', 'since 1960', 'until 1969']]);
    expect(pageBands(m, { year: 1969, month: 12 }, 'en-GB').year.map((b) => [b.ev.key, b.since, b.until])).toEqual([['sixties.md', 'since 1960', null]]);
    expect(pageBands(m, { year: -43, month: 3 }, 'en-GB').year.map((b) => b.ev.key)).toEqual(['bce.md']);
    expect(yearName(-43, 'en-GB')).toBe('44 BC');
    expect(monthTitle({ year: -43, month: 3 }, 'en-GB')).toBe('March 44 BC');
  });
});

describe('dayEvents', () => {
  it('every event covering the day: earlier-starting bars first, then by time', () => {
    const m = buildCalendarModel([
      row('late.md', '2026-10-15T18:00'), row('bar.md', '2026-10-13', '2026-10-16'),
      row('early.md', '2026-10-15T08:00'), row('allday.md', '2026-10-15'), row('other.md', '2026-10-16'),
    ], PROPS);
    expect(dayEvents(m.grid, civilMs(2026, 9, 15)).map((e) => e.key)).toEqual(['bar.md', 'allday.md', 'early.md', 'late.md']);
  });

  it('a clock end at midnight does not spill into the next day', () => {
    const m = buildCalendarModel([row('night.md', '2026-10-15T20:00', '2026-10-16T00:00')], PROPS);
    expect(dayEvents(m.grid, civilMs(2026, 9, 16))).toEqual([]);
  });
});

describe('times', () => {
  it('a clock start shows its time; a day start has none', () => {
    const m = buildCalendarModel([row('clock.md', '2026-10-06T09:30'), row('day.md', '2026-10-06')], PROPS);
    expect(timeOf(m.byKey.get('clock.md')!, 'en-US')).toBe('9:30 AM');
    expect(timeOf(m.byKey.get('day.md')!, 'en-US')).toBeNull();
  });

  it('"written as" only for an offset value shown on a different day', () => {
    const ev = (start: number) => ({ start });
    expect(writtenAs(ev(civilMs(2026, 9, 6, 0, 30)), '2026-10-05T23:30-05:00')).toBe('Written as 2026-10-05T23:30-05:00');
    expect(writtenAs(ev(civilMs(2026, 9, 5, 21, 30)), '2026-10-05T23:30-05:00')).toBeNull();
    expect(writtenAs(ev(civilMs(2026, 9, 6)), '2026-10-05T23:30')).toBeNull(); // floating: never moved
    expect(writtenAs(ev(civilMs(2026, 9, 6)), '2026-10-05')).toBeNull();
  });
});
