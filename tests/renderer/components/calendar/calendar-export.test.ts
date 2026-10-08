/**
 * What an exported Calendar month draws (#2704): multi-day events as bars
 * with row-wide slots, single days listed in their cell in order, per-day
 * counts, and whether anything hatched is drawn (the legend).
 */
import { describe, it, expect } from 'vitest';
import { planCalendarExport, singleIsApprox } from '../../../../src/renderer/lib/components/calendar/calendar-export';
import { buildCalendarModel } from '../../../../src/renderer/lib/components/calendar/calendar-model';
import { civilMs } from '../../../../src/shared/objects/date-precision';
import type { TypeInstanceRow } from '../../../../src/shared/objects/type-def';

const row = (path: string, title: string, date: string | null, end: string | null = null): TypeInstanceRow =>
  ({ path, title, values: { date, end }, cover: null });
const grid = (rows: TypeInstanceRow[]) => buildCalendarModel(rows, { dateProperty: 'date', endProperty: 'end', locale: 'en-GB' }).grid;
const OCT = { year: 2026, month: 10 };
const day = (d: number) => civilMs(2026, 9, d);

describe('planCalendarExport', () => {
  it('bars take row-wide slots; single days are listed in their cell by start, then title', () => {
    const events = grid([
      row('trip.md', 'Trip', '2026-10-09', '2026-10-14'),
      row('conf.md', 'Conf', '2026-10-08', '2026-10-10'),
      row('late.md', 'Late', '2026-10-09T18:00:00'),
      row('early.md', 'Early', '2026-10-09T07:00:00'),
      row('allday.md', 'All day', '2026-10-09'),
    ]);
    const plan = planCalendarExport(events, OCT, 1);
    expect(plan.weeks).toHaveLength(5);
    const r1 = plan.rows[1]!; // 5–11 Oct
    expect(r1.bars.map((s) => [s.key, s.startCol, s.endCol, s.slot])).toEqual([['conf.md', 3, 6, 0], ['trip.md', 4, 7, 1]]);
    expect(r1.barSlots).toBe(2);
    expect(r1.singles[4]!.map((e) => e.key)).toEqual(['allday.md', 'early.md', 'late.md']);
    expect(r1.counts).toEqual([0, 0, 0, 1, 5, 2, 1]);
    expect(plan.rows[2]!.bars.map((s) => [s.key, s.startCol, s.continuesBefore])).toEqual([['trip.md', 0, true]]);
    expect(plan.rows[2]!.barSlots).toBe(1);
    expect(plan.rows[0]!.barSlots).toBe(0);
    expect(plan.hatched).toBe(false);
  });

  it('days of the neighbouring months shown on the page carry their events too', () => {
    const plan = planCalendarExport(grid([row('sep.md', 'Late September', '2026-09-29'), row('nov.md', 'Early November', '2026-11-01')]), OCT, 1);
    expect(plan.rows[0]!.singles[1]!.map((e) => e.key)).toEqual(['sep.md']);
    expect(plan.rows[4]!.singles[6]!.map((e) => e.key)).toEqual(['nov.md']);
    expect(plan.rows[4]!.week.days[6]!.start).toBe(civilMs(2026, 10, 1));
  });

  it('flags anything hatched: a bar whose end is a month, or a single day whose end is', () => {
    expect(planCalendarExport(grid([row('launch.md', 'Launch', '2026-10-20', '2026-11')]), OCT, 1).hatched).toBe(true);
    // 31 October to "October" covers one day, but only approximately.
    const single = grid([row('eom.md', 'End of month', '2026-10-31', '2026-10')]);
    const plan = planCalendarExport(single, OCT, 1);
    expect(plan.rows[4]!.singles[5]!.map((e) => e.key)).toEqual(['eom.md']);
    expect(singleIsApprox(single[0]!)).toBe(true);
    expect(plan.hatched).toBe(true);
    expect(planCalendarExport(grid([row('d.md', 'Day', '2026-10-31')]), OCT, 1).hatched).toBe(false);
  });

  it('honours the week start', () => {
    const plan = planCalendarExport(grid([row('a.md', 'A', '2026-10-04')]), OCT, 7);
    expect(plan.weeks[0]!.start).toBe(civilMs(2026, 8, 27)); // Sunday 27 September
    expect(plan.rows[1]!.singles[0]!.map((e) => e.key)).toEqual(['a.md']); // Sunday 4 October, first column
    expect(day(4)).toBe(plan.rows[1]!.week.days[0]!.start);
  });
});
