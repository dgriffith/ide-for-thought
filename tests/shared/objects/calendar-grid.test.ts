/**
 * Month-grid date maths (#2700): the weeks of a month page, ISO week numbers,
 * keyboard day movement, placement by start precision, per-row segments and
 * their slots, and "+N more". See `calendar-grid.ts`'s header and
 * `docs/vision/objects-expansion.md` ("Calendar").
 */
import { describe, it, expect } from 'vitest';
import {
  addDays, addMonths, addMonthsClamped, coveredDays, dayStart, formatMonthAnchor, isoWeekOf, layoutMonth,
  monthBounds, monthOf, monthWeeks, overflowRow, parseMonthAnchor, placementOf, rangeMeets, rowWeekNumber,
  segmentByWeek, uncertainFrom, weekEdge, weekdayOf,
  type CalendarItem, type GridWeek, type RowLayout, type Weekday,
} from '../../../src/shared/objects/calendar-grid';
import { civilMs, dateRange, type DateRange } from '../../../src/shared/objects/date-precision';
import { DAY_MS } from '../../../src/shared/time';

/** `YYYY-MM-DD` (signed years allowed) for a civil-ms day. */
function iso(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const ys = y < 0 ? `-${String(-y).padStart(4, '0')}` : String(y).padStart(4, '0');
  return `${ys}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const day = (y: number, m: number, d: number) => civilMs(y, m - 1, d);
const rowStarts = (weeks: GridWeek[]) => weeks.map((w) => iso(w.start));
function range(start: string, end?: string): DateRange {
  const r = dateRange(start, end, { zoneOffsetMinutes: () => 0 });
  if (!r.ok) throw new Error(`not a range: ${start}`);
  return r.range;
}

describe('weekdayOf / dayStart', () => {
  it('numbers weekdays as getWeekInfo does (1 = Monday … 7 = Sunday)', () => {
    expect(weekdayOf(day(2026, 10, 5))).toBe(1); // Monday
    expect(weekdayOf(day(2026, 10, 1))).toBe(4); // Thursday
    expect(weekdayOf(day(2026, 10, 4))).toBe(7); // Sunday
    expect(weekdayOf(day(0, 1, 1))).toBe(6); // 1 Jan 1 BCE was a Saturday (proleptic)
    expect(weekdayOf(day(-43, 3, 15))).toBe(weekdayOf(day(-43, 3, 8)));
  });

  it('a clock time belongs to its civil day, before 1970 too', () => {
    expect(dayStart(day(2026, 10, 5) + 23.5 * 3_600_000)).toBe(day(2026, 10, 5));
    expect(dayStart(day(1969, 7, 20) + 20 * 3_600_000)).toBe(day(1969, 7, 20));
    expect(dayStart(day(-43, 3, 15) + 1)).toBe(day(-43, 3, 15));
  });
});

describe('months', () => {
  it('addMonths crosses years both ways, and year 0', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 10 }, -22)).toEqual({ year: 2024, month: 12 });
    expect(addMonths({ year: 0, month: 1 }, -1)).toEqual({ year: -1, month: 12 });
    expect(addMonths({ year: -1, month: 12 }, 1)).toEqual({ year: 0, month: 1 });
    expect(addMonths({ year: -43, month: 3 }, 12)).toEqual({ year: -42, month: 3 });
  });

  it('monthOf / monthBounds', () => {
    expect(monthOf(day(1969, 7, 20) + 5)).toEqual({ year: 1969, month: 7 });
    expect(monthBounds({ year: 2026, month: 2 })).toEqual({ start: day(2026, 2, 1), end: day(2026, 3, 1) });
    expect(monthBounds({ year: 2026, month: 12 }).end).toBe(day(2027, 1, 1));
    expect(monthBounds({ year: 44, month: 1 }).start).toBe(day(44, 1, 1)); // not 1944
  });

  it('parses and writes the month anchor in the date grammar', () => {
    expect(parseMonthAnchor('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonthAnchor(' 2026-10 ')).toEqual({ year: 2026, month: 10 });
    expect(parseMonthAnchor('-0043-03')).toEqual({ year: -43, month: 3 });
    expect(parseMonthAnchor('+12026-01')).toEqual({ year: 12026, month: 1 });
    for (const bad of ['2026', '2026-10-05', '2026-13', '2026-1', 'October', '', null, 202610, {}]) {
      expect(parseMonthAnchor(bad)).toBeNull();
    }
    for (const text of ['2026-10', '0044-01', '-0043-03', '+12026-01', '0000-12']) {
      expect(formatMonthAnchor(parseMonthAnchor(text)!)).toBe(text);
    }
  });
});

describe('monthWeeks', () => {
  it('October 2026, Monday start: five rows from 28 Sep to 1 Nov', () => {
    const w = monthWeeks({ year: 2026, month: 10 }, 1);
    expect(rowStarts(w)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(w[0]!.days.map((d) => d.inMonth)).toEqual([false, false, false, true, true, true, true]);
    expect(iso(w[4]!.days[6]!.start)).toBe('2026-11-01');
    expect(w[4]!.days.map((d) => d.inMonth)).toEqual([true, true, true, true, true, true, false]);
    expect(w[0]!.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('October 2026, Sunday start: five rows ending exactly on the 31st', () => {
    const w = monthWeeks({ year: 2026, month: 10 }, 7);
    expect(rowStarts(w)).toEqual(['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
    expect(w[0]!.days.map((d) => d.weekday)).toEqual([7, 1, 2, 3, 4, 5, 6]);
    expect(w[4]!.days.every((d) => d.inMonth)).toBe(true);
  });

  it('October 2026, Saturday start (ar-EG, fa-IR): six rows', () => {
    const w = monthWeeks({ year: 2026, month: 10 }, 6);
    expect(w).toHaveLength(6);
    expect(iso(w[0]!.start)).toBe('2026-09-26');
    expect(iso(w[5]!.start)).toBe('2026-10-31');
  });

  it('February 2026 (starts on a Sunday, 28 days) is exactly four rows with a Sunday start', () => {
    const w = monthWeeks({ year: 2026, month: 2 }, 7);
    expect(w).toHaveLength(4);
    expect(w.flatMap((x) => x.days).every((d) => d.inMonth)).toBe(true);
    expect(monthWeeks({ year: 2026, month: 2 }, 1)).toHaveLength(5);
  });

  it('August 2026 needs six rows with either start', () => {
    expect(monthWeeks({ year: 2026, month: 8 }, 7)).toHaveLength(6);
    expect(monthWeeks({ year: 2026, month: 8 }, 1)).toHaveLength(6);
  });

  it('crosses a year boundary: December 2026 trails into January 2027', () => {
    const w = monthWeeks({ year: 2026, month: 12 }, 1);
    const last = w[w.length - 1]!.days;
    expect(last.map((d) => iso(d.start))).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
    expect(last[4]).toMatchObject({ year: 2027, month: 1, day: 1, inMonth: false });
    const jan = monthWeeks({ year: 2027, month: 1 }, 1);
    expect(iso(jan[0]!.start)).toBe('2026-12-28');
  });

  it('a leap February has its 29th', () => {
    const days = monthWeeks({ year: 2028, month: 2 }, 1).flatMap((w) => w.days).filter((d) => d.inMonth);
    expect(days).toHaveLength(29);
    expect(monthWeeks({ year: 1900, month: 2 }, 1).flatMap((w) => w.days).filter((d) => d.inMonth)).toHaveLength(28);
    expect(monthWeeks({ year: 2000, month: 2 }, 1).flatMap((w) => w.days).filter((d) => d.inMonth)).toHaveLength(29);
  });

  it('BCE months: March 44 BCE, and 1 BCE → 1 CE (year 0 is a leap year)', () => {
    const w = monthWeeks({ year: -43, month: 3 }, 1);
    const inMonth = w.flatMap((x) => x.days).filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth.find((d) => d.day === 15)).toMatchObject({ year: -43, month: 3 });
    expect(iso(w[0]!.days.find((d) => d.inMonth)!.start)).toBe('-0043-03-01');
    expect(monthWeeks({ year: 0, month: 2 }, 1).flatMap((x) => x.days).filter((d) => d.inMonth)).toHaveLength(29);
    const dec = monthWeeks({ year: -1, month: 12 }, 1);
    expect(dec[dec.length - 1]!.days.some((d) => d.year === 0 && d.month === 1 && !d.inMonth)).toBe(true);
  });

  it('for every week start and every month of a span of years: whole weeks, each in-month day once, in order', () => {
    for (const ws of [1, 2, 3, 4, 5, 6, 7] as Weekday[]) {
      for (let y = 2023; y <= 2029; y++) {
        for (let m = 1; m <= 12; m++) {
          const w = monthWeeks({ year: y, month: m }, ws);
          const days = w.flatMap((x) => x.days);
          expect(w.length).toBeGreaterThanOrEqual(4);
          expect(w.length).toBeLessThanOrEqual(6);
          days.forEach((d, i) => { if (i > 0) expect(d.start - days[i - 1]!.start).toBe(DAY_MS); });
          expect(w.every((x) => x.days[0]!.weekday === ws)).toBe(true);
          const { start, end } = monthBounds({ year: y, month: m });
          expect(days.filter((d) => d.inMonth)).toHaveLength((end - start) / DAY_MS);
          expect(w[0]!.days.some((d) => d.inMonth)).toBe(true);
          expect(w[w.length - 1]!.days.some((d) => d.inMonth)).toBe(true);
        }
      }
    }
  });

  it('is DST-blind: the US and EU change dates are ordinary 24-hour days', () => {
    // 8 Mar and 1 Nov 2026 (US), 29 Mar and 25 Oct 2026 (EU).
    for (const [y, m] of [[2026, 3], [2026, 10], [2026, 11]] as const) {
      const days = monthWeeks({ year: y, month: m }, 7).flatMap((w) => w.days);
      days.forEach((d, i) => { if (i > 0) expect(d.start - days[i - 1]!.start).toBe(DAY_MS); });
    }
  });
});

describe('ISO week numbers', () => {
  it('isoWeekOf, including the week-numbering year near 1 January', () => {
    expect(isoWeekOf(day(2026, 10, 7))).toEqual({ year: 2026, week: 41 });
    expect(isoWeekOf(day(2026, 1, 1))).toEqual({ year: 2026, week: 1 }); // a Thursday
    expect(isoWeekOf(day(2026, 12, 31))).toEqual({ year: 2026, week: 53 }); // 2026 has 53
    expect(isoWeekOf(day(2027, 1, 3))).toEqual({ year: 2026, week: 53 });
    expect(isoWeekOf(day(2027, 1, 4))).toEqual({ year: 2027, week: 1 });
    expect(isoWeekOf(day(2021, 1, 1))).toEqual({ year: 2020, week: 53 });
    expect(isoWeekOf(day(2024, 12, 30))).toEqual({ year: 2025, week: 1 });
  });

  it('a row is labelled with the ISO week of its Thursday, whatever the week start', () => {
    const mon = monthWeeks({ year: 2026, month: 10 }, 1);
    expect(mon.map((w) => rowWeekNumber(w).week)).toEqual([40, 41, 42, 43, 44]);
    const sun = monthWeeks({ year: 2026, month: 10 }, 7);
    // Sun 27 Sep – Sat 3 Oct: six of its days are ISO week 40.
    expect(sun.map((w) => rowWeekNumber(w).week)).toEqual([40, 41, 42, 43, 44]);
    const dec = monthWeeks({ year: 2026, month: 12 }, 1);
    expect(rowWeekNumber(dec[dec.length - 1]!)).toEqual({ year: 2026, week: 53 });
  });
});

describe('keyboard day movement', () => {
  it('arrows are ±1 / ±7 days across month and year boundaries', () => {
    expect(iso(addDays(day(2026, 10, 31), 1))).toBe('2026-11-01');
    expect(iso(addDays(day(2026, 12, 29), 7))).toBe('2027-01-05');
    expect(iso(addDays(day(2028, 2, 28), 1))).toBe('2028-02-29');
    expect(iso(addDays(day(0, 1, 1), -1))).toBe('-0001-12-31');
  });

  it('Page Up/Down keep the day of the month, clamped to the target month', () => {
    expect(iso(addMonthsClamped(day(2026, 1, 31), 1))).toBe('2026-02-28');
    expect(iso(addMonthsClamped(day(2028, 1, 31), 1))).toBe('2028-02-29');
    expect(iso(addMonthsClamped(day(2026, 3, 31), -1))).toBe('2026-02-28');
    expect(iso(addMonthsClamped(day(2026, 10, 15), -1))).toBe('2026-09-15');
    expect(iso(addMonthsClamped(day(2026, 12, 31), 1))).toBe('2027-01-31');
    expect(iso(addMonthsClamped(day(2028, 2, 29), 12))).toBe('2029-02-28'); // Shift+Page Down
    expect(iso(addMonthsClamped(day(2028, 2, 29), 48))).toBe('2032-02-29');
    expect(iso(addMonthsClamped(day(-43, 3, 15), -12))).toBe('-0044-03-15');
  });

  it('Home/End go to the row\'s first and last day for the week start', () => {
    const thu = day(2026, 10, 1);
    expect(iso(weekEdge(thu, 1, 'start'))).toBe('2026-09-28');
    expect(iso(weekEdge(thu, 1, 'end'))).toBe('2026-10-04');
    expect(iso(weekEdge(thu, 7, 'start'))).toBe('2026-09-27');
    expect(iso(weekEdge(thu, 7, 'end'))).toBe('2026-10-03');
    expect(iso(weekEdge(thu, 6, 'start'))).toBe('2026-09-26');
    const sun = day(2026, 10, 4);
    expect(iso(weekEdge(sun, 7, 'start'))).toBe('2026-10-04');
    expect(iso(weekEdge(sun, 1, 'start'))).toBe('2026-09-28');
  });
});

describe('placement by start precision', () => {
  it('a day or clock start is in the cells; a month start the month band; a year start the year band', () => {
    expect(placementOf(range('1969-07-20'))).toBe('grid');
    expect(placementOf(range('1969-07-20T20:17'))).toBe('grid');
    expect(placementOf(range('1969-07-20T20:17:40.5Z'))).toBe('grid');
    expect(placementOf(range('1969-07'))).toBe('month');
    expect(placementOf(range('1969-07', '1969-09-02'))).toBe('month');
    expect(placementOf(range('1969'))).toBe('year');
    expect(placementOf(range('1969', '1971'))).toBe('year');
  });

  it('a band item appears on every month page its range meets', () => {
    const r = range('1969-07', '1969-09'); // July through September
    const meets = (y: number, m: number) => { const b = monthBounds({ year: y, month: m }); return rangeMeets(r, b.start, b.end); };
    expect([6, 7, 8, 9, 10].map((m) => meets(1969, m))).toEqual([false, true, true, true, false]);
    const y = range('1969');
    const all = Array.from({ length: 12 }, (_, i) => monthBounds({ year: 1969, month: i + 1 }));
    expect(all.every((b) => rangeMeets(y, b.start, b.end))).toBe(true);
    const dec68 = monthBounds({ year: 1968, month: 12 });
    expect(rangeMeets(y, dec68.start, dec68.end)).toBe(false);
  });

  it('a day start with a coarser end is uncertain from the end\'s span', () => {
    expect(uncertainFrom(range('1969-07-20', '1969-08'))).toBe(day(1969, 8, 1));
    expect(uncertainFrom(range('1969-07-20', '1970'))).toBe(day(1970, 1, 1));
    expect(uncertainFrom(range('1969-07-20', '1969-07-24'))).toBeNull();
    expect(uncertainFrom(range('1969-07-20T10:00', '1969-07-21T10:00'))).toBeNull();
    expect(uncertainFrom(range('1969-07-20'))).toBeNull();
  });
});

describe('coveredDays', () => {
  it('a half-open range covers every day it meets; a midnight clock end does not spill', () => {
    const c = (s: string, e?: string) => { const x = coveredDays(range(s, e)); return [iso(x.first), iso(x.last)]; };
    expect(c('2026-10-05')).toEqual(['2026-10-05', '2026-10-05']);
    expect(c('2026-10-05', '2026-10-07')).toEqual(['2026-10-05', '2026-10-07']);
    expect(c('2026-10-05T22:00', '2026-10-06T00:00')).toEqual(['2026-10-05', '2026-10-05']);
    expect(c('2026-10-05T22:00', '2026-10-06T00:01')).toEqual(['2026-10-05', '2026-10-06']);
    expect(c('2026-10-05T23:59')).toEqual(['2026-10-05', '2026-10-05']);
    expect(c('2026-10-05', '2026-11')).toEqual(['2026-10-05', '2026-11-30']);
  });
});

describe('segmentByWeek', () => {
  const oct = monthWeeks({ year: 2026, month: 10 }, 1); // rows start 28 Sep, 5, 12, 19, 26 Oct

  it('a single day is one segment of one column', () => {
    expect(segmentByWeek(range('2026-10-07'), oct)).toEqual([
      { row: 1, startCol: 2, endCol: 3, continuesBefore: false, continuesAfter: false, uncertainFromCol: null },
    ]);
  });

  it('splits a span at each row, with continuation flags', () => {
    // Fri 9 Oct – Tue 20 Oct: rows 1 (Fri–Sun), 2 (whole), 3 (Mon–Tue).
    expect(segmentByWeek(range('2026-10-09', '2026-10-20'), oct)).toEqual([
      { row: 1, startCol: 4, endCol: 7, continuesBefore: false, continuesAfter: true, uncertainFromCol: null },
      { row: 2, startCol: 0, endCol: 7, continuesBefore: true, continuesAfter: true, uncertainFromCol: null },
      { row: 3, startCol: 0, endCol: 2, continuesBefore: true, continuesAfter: false, uncertainFromCol: null },
    ]);
  });

  it('a span that starts before the page and ends after it is cut to the page, flagged both ways', () => {
    const s = segmentByWeek(range('2026-09-01', '2026-12-31'), oct);
    expect(s).toHaveLength(5);
    expect(s[0]).toMatchObject({ row: 0, startCol: 0, continuesBefore: true });
    expect(s[4]).toMatchObject({ row: 4, endCol: 7, continuesAfter: true });
  });

  it('includes leading and trailing days from the neighbouring months', () => {
    expect(segmentByWeek(range('2026-09-28'), oct)).toEqual([
      { row: 0, startCol: 0, endCol: 1, continuesBefore: false, continuesAfter: false, uncertainFromCol: null },
    ]);
    expect(segmentByWeek(range('2026-11-01'), oct)[0]).toMatchObject({ row: 4, startCol: 6, endCol: 7 });
    expect(segmentByWeek(range('2026-11-02'), oct)).toEqual([]);
    expect(segmentByWeek(range('2026-09-27'), oct)).toEqual([]);
  });

  it('crosses a year boundary', () => {
    const dec = monthWeeks({ year: 2026, month: 12 }, 1);
    const s = segmentByWeek(range('2026-12-30', '2027-01-02'), dec);
    expect(s).toEqual([{ row: dec.length - 1, startCol: 2, endCol: 6, continuesBefore: false, continuesAfter: false, uncertainFromCol: null }]);
    const jan = monthWeeks({ year: 2027, month: 1 }, 1);
    expect(segmentByWeek(range('2026-12-30', '2027-01-02'), jan)[0]).toMatchObject({ row: 0, startCol: 2, endCol: 6 });
  });

  it('marks the uncertain stretch of a coarse end', () => {
    // 28 Oct, ending "sometime in November": certain 28–31 Oct, uncertain from 1 Nov.
    const r = range('2026-10-28', '2026-11');
    expect(segmentByWeek(r, oct, uncertainFrom(r))).toEqual([
      { row: 4, startCol: 2, endCol: 7, continuesBefore: false, continuesAfter: true, uncertainFromCol: 6 },
    ]);
    const nov = monthWeeks({ year: 2026, month: 11 }, 1);
    const ns = segmentByWeek(r, nov, uncertainFrom(r));
    // November's first row is the same week (26 Oct – 1 Nov), so the bar starts there too.
    expect(ns[0]).toMatchObject({ row: 0, startCol: 2, continuesBefore: false, uncertainFromCol: 6 });
    expect(ns[1]).toMatchObject({ row: 1, startCol: 0, uncertainFromCol: 0 });
  });

  it('BCE: a span across the Ides of March 44 BCE', () => {
    const w = monthWeeks({ year: -43, month: 3 }, 1);
    const s = segmentByWeek(range('-0043-03-14', '-0043-03-16'), w);
    const total = s.reduce((n, x) => n + x.endCol - x.startCol, 0);
    expect(total).toBe(3);
    expect(iso(w[s[0]!.row]!.days[s[0]!.startCol]!.start)).toBe('-0043-03-14');
  });

  it('an offset time sits on the viewer\'s local day (the range already carries it)', () => {
    // 23:30 at -05:00 is 04:30Z on the 6th; for a viewer at +01:00 that is 05:30 on the 6th.
    const r = dateRange('2026-10-05T23:30-05:00', null, { zoneOffsetMinutes: () => 60 });
    if (!r.ok) throw new Error('range');
    expect(segmentByWeek(r.range, oct)[0]).toMatchObject({ row: 1, startCol: 1, endCol: 2 }); // Tue 6 Oct
  });

  it('is empty for a range that doesn\'t run forwards', () => {
    expect(segmentByWeek({ start: 10, end: 10 }, oct)).toEqual([]);
  });
});

describe('layoutMonth', () => {
  const oct = monthWeeks({ year: 2026, month: 10 }, 1);
  const item = (key: string, start: string, end?: string, title = key): CalendarItem => ({ key, title, range: range(start, end) });
  const slots = (rows: RowLayout[], row: number) => Object.fromEntries(rows[row]!.segments.map((s) => [s.key, s.slot]));

  it('a bar keeps one slot across every day it covers in a row', () => {
    const rows = layoutMonth([
      item('mon', '2026-10-05'),
      item('bar', '2026-10-05', '2026-10-08'),
      item('wed', '2026-10-07'),
      item('thu', '2026-10-08'),
      item('sat', '2026-10-10'),
    ], oct);
    const seg = rows[1]!.segments.find((s) => s.key === 'bar')!;
    expect(seg).toMatchObject({ startCol: 0, endCol: 4 });
    // One slot for the whole bar; the single days stack around it.
    expect(slots(rows, 1)).toEqual({ mon: 0, bar: 1, wed: 0, thu: 0, sat: 0 });
    expect(rows[1]!.slotCount).toBe(2);
  });

  it('orders same-day events by start time, then title, then key', () => {
    const rows = layoutMonth([
      item('b', '2026-10-07T14:00', undefined, 'Afternoon'),
      item('a', '2026-10-07T09:00', undefined, 'Morning'),
      item('d', '2026-10-07', undefined, 'Zebra'),
      item('c', '2026-10-07', undefined, 'Apple'),
    ], oct);
    expect(rows[1]!.segments.map((s) => s.key)).toEqual(['c', 'd', 'a', 'b']);
    expect(slots(rows, 1)).toEqual({ c: 0, d: 1, a: 2, b: 3 });
  });

  it('uses the fewest slots: the most events on any one day of the row', () => {
    const items = [
      item('a', '2026-10-05', '2026-10-06'),
      item('b', '2026-10-06', '2026-10-07'),
      item('c', '2026-10-07', '2026-10-08'),
      item('d', '2026-10-08', '2026-10-09'),
    ];
    const rows = layoutMonth(items, oct);
    expect(rows[1]!.slotCount).toBe(2);
    expect(slots(rows, 1)).toEqual({ a: 0, b: 1, c: 0, d: 1 });
  });

  it('a bar continuing into the next row is packed afresh there', () => {
    const rows = layoutMonth([
      item('x', '2026-10-12'),
      item('long', '2026-10-10', '2026-10-13'),
    ], oct);
    expect(rows[1]!.segments.find((s) => s.key === 'long')).toMatchObject({ slot: 0, continuesAfter: true });
    // Row 2: both start on Monday; the one-day 'x' ends first, so it stacks first.
    expect(slots(rows, 2)).toEqual({ x: 0, long: 1 });
  });

  it('rows with nothing are empty; nothing outside the page is placed', () => {
    const rows = layoutMonth([item('far', '2027-03-01')], oct);
    expect(rows.every((r) => r.segments.length === 0 && r.slotCount === 0)).toBe(true);
  });

  it('is deterministic whatever the input order', () => {
    const items = [
      item('p/1.md', '2026-10-05', '2026-10-09', 'Same'),
      item('p/2.md', '2026-10-05', '2026-10-09', 'Same'),
      item('p/3.md', '2026-10-06'),
      item('p/4.md', '2026-10-06T08:00'),
      item('p/5.md', '2026-10-01', '2026-10-30'),
    ];
    const a = layoutMonth(items, oct);
    const b = layoutMonth([...items].reverse(), oct);
    expect(b).toEqual(a);
  });
});

describe('overflowRow', () => {
  const oct = monthWeeks({ year: 2026, month: 10 }, 1);
  const item = (key: string, start: string, end?: string): CalendarItem => ({ key, title: key, range: range(start, end) });
  const keys = (o: ReturnType<typeof overflowRow>) => o.visible.map((s) => s.key).sort();

  it('a day within capacity shows everything, with no "+N more"', () => {
    const [, row] = layoutMonth([item('a', '2026-10-05'), item('b', '2026-10-05'), item('c', '2026-10-05')], oct);
    expect(overflowRow(row!, 3)).toEqual({ visible: row!.segments, more: [0, 0, 0, 0, 0, 0, 0] });
  });

  it('a full day keeps its last slot for "+N more"', () => {
    const [, row] = layoutMonth(['a', 'b', 'c', 'd', 'e'].map((k) => item(k, '2026-10-05')), oct);
    const o = overflowRow(row!, 3);
    expect(keys(o)).toEqual(['a', 'b']);
    expect(o.more).toEqual([3, 0, 0, 0, 0, 0, 0]);
  });

  it('a bar is never drawn in pieces: one crossing an overflowing day is hidden on all its days', () => {
    // Capacity 2. Mon has a, b, c (overflows). The bar sits in slot 1 Mon–Wed.
    const [, row] = layoutMonth([
      item('a', '2026-10-05'),
      item('bar', '2026-10-05', '2026-10-07'),
      item('c', '2026-10-05'),
      item('w', '2026-10-07'),
    ], oct);
    expect(row!.segments.find((s) => s.key === 'bar')!.slot).toBe(2);
    const o = overflowRow(row!, 2);
    expect(keys(o)).toEqual(['a', 'w']);
    expect(o.more).toEqual([2, 1, 1, 0, 0, 0, 0]);
  });

  it('a bar in the last slot stays when none of its days overflows', () => {
    const [, row] = layoutMonth([
      item('a', '2026-10-06'),
      item('bar', '2026-10-06', '2026-10-08'),
    ], oct);
    const o = overflowRow(row!, 2);
    expect(keys(o)).toEqual(['a', 'bar']);
    expect(o.more.every((n) => n === 0)).toBe(true);
  });

  it('every event is counted: visible plus "+N more" covers each day\'s events', () => {
    const items: CalendarItem[] = [];
    for (let i = 0; i < 40; i++) {
      const d = 5 + (i * 7) % 7 + (i % 5);
      items.push(item(`e${String(i).padStart(2, '0')}`, `2026-10-${String(d).padStart(2, '0')}`, i % 3 === 0 ? `2026-10-${String(Math.min(11, d + 2)).padStart(2, '0')}` : undefined));
    }
    const [, row] = layoutMonth(items, oct);
    for (const cap of [0, 1, 2, 3, 4, 6, 50]) {
      const o = overflowRow(row!, cap);
      for (let c = 0; c < 7; c++) {
        const onDay = row!.segments.filter((s) => s.startCol <= c && c < s.endCol).length;
        const shown = o.visible.filter((s) => s.startCol <= c && c < s.endCol).length;
        expect(shown + o.more[c]!).toBe(onDay);
        // What's drawn, plus the "+N more" line, fits the cell.
        if (cap > 0) expect(shown + (o.more[c]! > 0 ? 1 : 0)).toBeLessThanOrEqual(cap);
        // Nothing drawn in a slot the "+N more" line uses.
        if (o.more[c]! > 0) expect(o.visible.every((s) => !(s.startCol <= c && c < s.endCol) || s.slot < cap - 1)).toBe(true);
      }
    }
  });

  it('capacity 0 hides everything into "+N more"', () => {
    const [, row] = layoutMonth([item('a', '2026-10-05')], oct);
    expect(overflowRow(row!, 0)).toEqual({ visible: [], more: [1, 0, 0, 0, 0, 0, 0] });
  });
});
