/**
 * The reschedule rule (#2700): a move is a whole number of civil days; it
 * keeps precision, the written form and the duration; partial dates and
 * coarse ends aren't moved; an offset start lands on the viewer's target day.
 * See `date-shift.ts`'s header and `docs/vision/objects-expansion.md`
 * ("Calendar").
 */
import { describe, it, expect } from 'vitest';
import { rescheduleByDays, rescheduleRefusal, shiftDateValue, startDayOf } from '../../../src/shared/objects/date-shift';
import { civilMs, dateRange, dateSpan, type SpanOptions } from '../../../src/shared/objects/date-precision';
import { coveredDays } from '../../../src/shared/objects/calendar-grid';

/** A named zone's offset at an instant, from `Intl` — independent of the runner's TZ. */
function zone(timeZone: string): SpanOptions {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  });
  return {
    zoneOffsetMinutes: (instant: number) => {
      const p = Object.fromEntries(f.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
      const wall = civilMs(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
      return Math.round((wall - Math.floor(instant / 60_000) * 60_000) / 60_000);
    },
  };
}
const NY = zone('America/New_York');
const LONDON = zone('Europe/London');
const AUCKLAND = zone('Pacific/Auckland');
const UTC: SpanOptions = { zoneOffsetMinutes: () => 0 };

function iso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const localDay = (raw: string, opts: SpanOptions) => iso(startDayOf(raw, opts)!);

describe('shiftDateValue', () => {
  it('moves a date by days across month and year boundaries', () => {
    expect(shiftDateValue('2026-10-05', 2)).toBe('2026-10-07');
    expect(shiftDateValue('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDateValue('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDateValue('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDateValue('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDateValue('2026-10-05', 365)).toBe('2027-10-05');
    expect(shiftDateValue('2026-10-05', 0)).toBe('2026-10-05');
  });

  it('leap days: a day move never needs clamping', () => {
    expect(shiftDateValue('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDateValue('2027-02-28', 1)).toBe('2027-03-01');
    expect(shiftDateValue('2028-02-29', 1)).toBe('2028-03-01');
    expect(shiftDateValue('2028-02-29', 7)).toBe('2028-03-07');
    expect(shiftDateValue('2028-02-29', 365)).toBe('2029-02-28'); // 365 days on, not "the same date"
    expect(shiftDateValue('2028-02-29', 366)).toBe('2029-03-01');
    expect(shiftDateValue('2026-01-31', 29)).toBe('2026-03-01');
    expect(shiftDateValue('2028-01-31', 29)).toBe('2028-02-29');
    expect(shiftDateValue('1900-02-28', 1)).toBe('1900-03-01');
    expect(shiftDateValue('2000-02-28', 1)).toBe('2000-02-29');
  });

  it('keeps the time of day, seconds, fraction and offset exactly as written', () => {
    expect(shiftDateValue('2026-10-05T23:30', 1)).toBe('2026-10-06T23:30');
    expect(shiftDateValue('2026-10-05T23:30-05:00', 1)).toBe('2026-10-06T23:30-05:00');
    expect(shiftDateValue('2026-10-05T09:00:05Z', -5)).toBe('2026-09-30T09:00:05Z');
    expect(shiftDateValue('2026-10-05T09:00:05.5+05:30', 30)).toBe('2026-11-04T09:00:05.5+05:30');
    expect(shiftDateValue('2026-10-05T09:00:00.120+00:00', 1)).toBe('2026-10-06T09:00:00.120+00:00');
  });

  it('a floating time keeps its wall clock across a DST change', () => {
    // 8 March 2026 is the US spring-forward day; a floating 02:30 is still 02:30.
    expect(shiftDateValue('2026-03-07T02:30', 1)).toBe('2026-03-08T02:30');
    const before = dateSpan('2026-03-07T02:30', NY)!.start;
    const after = dateSpan('2026-03-08T02:30', NY)!.start;
    expect(after - before).toBe(86_400_000);
  });

  it('keeps the year\'s written form, expanding only when it must', () => {
    expect(shiftDateValue('0044-03-15', 1)).toBe('0044-03-16');
    expect(shiftDateValue('-0043-03-15', 1)).toBe('-0043-03-16');
    expect(shiftDateValue('-0043-12-31', 1)).toBe('-0042-01-01');
    expect(shiftDateValue('-0001-12-31', 1)).toBe('0000-01-01');
    expect(shiftDateValue('0000-01-01', -1)).toBe('-0001-12-31');
    expect(shiftDateValue('0000-02-28', 1)).toBe('0000-02-29'); // year 0 is a leap year
    expect(shiftDateValue('9999-12-31', 1)).toBe('+10000-01-01');
    expect(shiftDateValue('+12026-01-01', -1)).toBe('+12025-12-31');
    expect(shiftDateValue('+02026-10-05', 1)).toBe('+02026-10-06');
    expect(shiftDateValue('-000043-03-15', 1)).toBe('-000043-03-16');
    // An expansion the result forced is the written form from then on.
    expect(shiftDateValue('+10000-01-01', -1)).toBe('+09999-12-31');
  });

  it('trims surrounding whitespace, as the parser does', () => {
    expect(shiftDateValue('  2026-10-05 ', 1)).toBe('2026-10-06');
  });

  it('is null for a partial date, an invalid value, a fractional day count, or leaving Date\'s range', () => {
    expect(shiftDateValue('1969', 1)).toBeNull();
    expect(shiftDateValue('1969-07', 1)).toBeNull();
    expect(shiftDateValue('1969-02-30', 1)).toBeNull();
    expect(shiftDateValue('July 20, 1969', 1)).toBeNull();
    expect(shiftDateValue('', 1)).toBeNull();
    expect(shiftDateValue('2026-10-05', 0.5)).toBeNull();
    expect(shiftDateValue('2026-10-05', Number.NaN)).toBeNull();
    expect(shiftDateValue('+275760-09-12', 2)).toBeNull();
  });

  it('round-trips: moving forward then back gives the value back', () => {
    const values = ['2026-10-05', '2028-02-29', '-0043-03-15', '0000-06-01', '2026-10-05T23:30-05:00', '2026-10-05T07:00:00.5Z', '+12026-01-01'];
    for (const v of values) for (const n of [1, 7, 29, 31, 365, 366, 1000]) {
      expect(shiftDateValue(shiftDateValue(v, n)!, -n)).toBe(v);
    }
  });
});

describe('rescheduleRefusal', () => {
  it('a month or year start is not draggable; nor is an end that is only a month or year', () => {
    expect(rescheduleRefusal('1969-07', null)).toBe('not-a-day');
    expect(rescheduleRefusal('1969', '1970')).toBe('not-a-day');
    expect(rescheduleRefusal('1969-07-20', '1969-08')).toBe('end-not-a-day');
    expect(rescheduleRefusal('1969-07-20', '1970')).toBe('end-not-a-day');
    expect(rescheduleRefusal('nonsense', null)).toBe('invalid');
  });

  it('a day or clock start with no end, a day/clock end, or an unreadable end is draggable', () => {
    expect(rescheduleRefusal('1969-07-20', null)).toBeNull();
    expect(rescheduleRefusal('1969-07-20', undefined)).toBeNull();
    expect(rescheduleRefusal('1969-07-20', '')).toBeNull();
    expect(rescheduleRefusal('1969-07-20T20:17', '1969-07-21T02:56Z')).toBeNull();
    expect(rescheduleRefusal('1969-07-20', 'next week')).toBeNull();
  });
});

describe('rescheduleByDays', () => {
  it('keeps the duration: the end moves with the start', () => {
    expect(rescheduleByDays('2026-10-05', '2026-10-07', 3, UTC)).toEqual({ ok: true, start: '2026-10-08', end: '2026-10-10', days: 3 });
    expect(rescheduleByDays('2026-10-30', '2026-11-02', 3, UTC)).toEqual({ ok: true, start: '2026-11-02', end: '2026-11-05', days: 3 });
    expect(rescheduleByDays('2026-12-30T22:00', '2027-01-02T08:00', -30, UTC))
      .toEqual({ ok: true, start: '2026-11-30T22:00', end: '2026-12-03T08:00', days: -30 });
  });

  it('keeps each value\'s own precision when start and end differ', () => {
    expect(rescheduleByDays('2026-10-05', '2026-10-06T10:00', 1, UTC)).toEqual({ ok: true, start: '2026-10-06', end: '2026-10-07T10:00', days: 1 });
    expect(rescheduleByDays('2026-10-05T09:00+02:00', '2026-10-05T17:00', 2, UTC))
      .toEqual({ ok: true, start: '2026-10-07T09:00+02:00', end: '2026-10-07T17:00', days: 2 });
  });

  it('an offset range keeps its elapsed length exactly', () => {
    const r = rescheduleByDays('2026-10-05T23:30-05:00', '2026-10-06T01:15-05:00', 10, NY);
    if (!r.ok) throw new Error(r.reason);
    const before = dateRange('2026-10-05T23:30-05:00', '2026-10-06T01:15-05:00', UTC);
    const after = dateRange(r.start, r.end, UTC);
    if (!before.ok || !after.ok) throw new Error('range');
    expect(after.range.end - after.range.start).toBe(before.range.end - before.range.start);
  });

  it('with no end, or an end that is not a date, the end is left as it is', () => {
    expect(rescheduleByDays('2026-10-05', null, 1, UTC)).toEqual({ ok: true, start: '2026-10-06', end: null, days: 1 });
    expect(rescheduleByDays('2026-10-05', 'soonish', 1, UTC)).toEqual({ ok: true, start: '2026-10-06', end: null, days: 1 });
  });

  it('an end written before the start moves too, so the move never revives it', () => {
    expect(rescheduleByDays('2026-10-05', '2026-10-01', 10, UTC)).toEqual({ ok: true, start: '2026-10-15', end: '2026-10-11', days: 10 });
  });

  it('refuses partial dates and coarse ends with a reason', () => {
    expect(rescheduleByDays('1969-07', null, 1)).toEqual({ ok: false, reason: 'not-a-day' });
    expect(rescheduleByDays('1969', '1970', 1)).toEqual({ ok: false, reason: 'not-a-day' });
    expect(rescheduleByDays('1969-07-20', '1969-08', 1)).toEqual({ ok: false, reason: 'end-not-a-day' });
    expect(rescheduleByDays('1969-02-30', null, 1)).toEqual({ ok: false, reason: 'invalid' });
    expect(rescheduleByDays('1969-07-20', null, 1.5)).toEqual({ ok: false, reason: 'invalid' });
    expect(rescheduleByDays('+275760-09-12', null, 5)).toEqual({ ok: false, reason: 'out-of-range' });
    expect(rescheduleByDays('2026-10-05', '+275760-09-12', 5)).toEqual({ ok: false, reason: 'out-of-range' });
  });

  it('a zero move changes nothing', () => {
    expect(rescheduleByDays('2026-10-05T23:30-05:00', '2026-10-06', 0, NY)).toEqual({ ok: true, start: '2026-10-05T23:30-05:00', end: '2026-10-06', days: 0 });
  });

  describe('2026-10-05T23:30-05:00 for viewers in three zones (the epic\'s decision 5)', () => {
    const raw = '2026-10-05T23:30-05:00'; // 04:30Z on 6 October
    it('shows on 6 October in New York (00:30 EDT), London (05:30 BST) and Auckland (17:30 NZDT)', () => {
      expect(localDay(raw, NY)).toBe('2026-10-06');
      expect(localDay(raw, LONDON)).toBe('2026-10-06');
      expect(localDay(raw, AUCKLAND)).toBe('2026-10-06');
      const at = (o: SpanOptions) => new Date(dateSpan(raw, o)!.start).toISOString().slice(11, 16);
      expect([at(NY), at(LONDON), at(AUCKLAND)]).toEqual(['00:30', '05:30', '17:30']);
      // A floating value shows as written, on the 5th, for all three.
      for (const z of [NY, LONDON, AUCKLAND]) expect(localDay('2026-10-05T23:30', z)).toBe('2026-10-05');
    });

    it('dragged from the 6th to the 8th, it is written two days on and keeps -05:00', () => {
      for (const z of [NY, LONDON, AUCKLAND]) {
        const r = rescheduleByDays(raw, null, 2, z);
        expect(r).toEqual({ ok: true, start: '2026-10-07T23:30-05:00', end: null, days: 2 });
        expect(localDay('2026-10-07T23:30-05:00', z)).toBe('2026-10-08');
      }
    });

    it('in a grid, its civil range covers the viewer\'s 6th only', () => {
      for (const z of [NY, LONDON, AUCKLAND]) {
        const r = dateRange(raw, null, z);
        if (!r.ok) throw new Error('range');
        const c = coveredDays(r.range);
        expect([iso(c.first), iso(c.last)]).toEqual(['2026-10-06', '2026-10-06']);
      }
    });
  });

  describe('offset times across the viewer\'s DST change', () => {
    it('autumn: lands on the dropped day by writing one day further', () => {
      // London leaves BST at 01:00Z on 25 Oct 2026. 23:30Z on the 24th shows
      // at 00:30 BST on the 25th; on the 25th itself it shows at 23:30 GMT.
      const raw = '2026-10-24T23:30Z';
      expect(localDay(raw, LONDON)).toBe('2026-10-25');
      // Dropped one day on (the 26th). Written +1 day, it would show on the
      // 25th again — no visible move; so it is written +2 days, and shows on the 26th.
      expect(localDay('2026-10-25T23:30Z', LONDON)).toBe('2026-10-25');
      const r = rescheduleByDays(raw, '2026-10-25T00:30Z', 1, LONDON);
      expect(r).toEqual({ ok: true, start: '2026-10-26T23:30Z', end: '2026-10-27T00:30Z', days: 2 });
      expect(r.ok && localDay(r.start, LONDON)).toBe('2026-10-26');
    });

    it('autumn, two days: corrected to the target day', () => {
      const r = rescheduleByDays('2026-10-24T23:30Z', null, 2, LONDON);
      expect(r.ok && localDay(r.start, LONDON)).toBe('2026-10-27');
      expect(r).toMatchObject({ ok: true, days: 3 });
    });

    it('spring: a skipped local day cannot be reached, so the plain move stands', () => {
      // London enters BST at 01:00Z on 29 Mar 2026: 23:30Z shows on the 28th, then on the 30th.
      const raw = '2026-03-28T23:30Z';
      expect(localDay(raw, LONDON)).toBe('2026-03-28');
      expect(localDay('2026-03-29T23:30Z', LONDON)).toBe('2026-03-30');
      expect(rescheduleByDays(raw, null, 1, LONDON)).toEqual({ ok: true, start: '2026-03-29T23:30Z', end: null, days: 1 });
    });

    it('away from midnight, DST changes nothing', () => {
      expect(rescheduleByDays('2026-03-07T12:00-05:00', null, 7, NY)).toEqual({ ok: true, start: '2026-03-14T12:00-05:00', end: null, days: 7 });
      expect(localDay('2026-03-14T12:00-05:00', NY)).toBe('2026-03-14');
    });

    it('every offset start in a year of drags lands on the target day unless that day is skipped', () => {
      for (const z of [NY, LONDON, AUCKLAND]) {
        for (let d = 0; d < 365; d += 3) {
          const day = new Date(civilMs(2026, 0, 1 + d)).toISOString().slice(0, 10);
          for (const time of ['00:15', '12:00', '23:45']) {
            const raw = `${day}T${time}Z`;
            const target = startDayOf(raw, z)! + 86_400_000;
            const r = rescheduleByDays(raw, null, 1, z);
            if (!r.ok) throw new Error(r.reason);
            const landed = startDayOf(r.start, z)!;
            if (landed !== target) {
              // Only possible when no whole-day move hits the target.
              for (const n of [0, 1, 2]) expect(startDayOf(`${new Date(civilMs(2026, 0, 1 + d + n)).toISOString().slice(0, 10)}T${time}Z`, z)).not.toBe(target);
            }
          }
        }
      }
    });
  });
});

describe('startDayOf', () => {
  it('is the viewer\'s day for an offset time, the written day otherwise', () => {
    expect(localDay('2026-10-05', NY)).toBe('2026-10-05');
    expect(localDay('2026-10-05T23:30', AUCKLAND)).toBe('2026-10-05');
    expect(localDay('2026-10-05T23:30Z', AUCKLAND)).toBe('2026-10-06');
    expect(localDay('2026-10-05T01:00Z', NY)).toBe('2026-10-04');
  });

  it('is null for a partial or invalid start', () => {
    expect(startDayOf('1969-07')).toBeNull();
    expect(startDayOf('1969')).toBeNull();
    expect(startDayOf('x')).toBeNull();
  });
});
