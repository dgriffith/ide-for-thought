/**
 * Date precision (#2611): how a written date value becomes a span of the
 * civil axis, and how a start + end become one range. The decisions are in
 * `docs/vision/objects-expansion.md` ("Timeline"); this table is them, made
 * executable.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_CIVIL_MS, PRECISION_ORDER, civilMs, dateRange, dateSpan, isClockPrecision, parseDateValue,
  type DateRange, type SpanOptions,
} from '../../../src/shared/objects/date-precision';
import { matchesFilter } from '../../../src/shared/objects/view-spec';

const U = (y: number, m = 1, d = 1, h = 0, mi = 0, s = 0, ms = 0) => civilMs(y, m - 1, d, h, mi, s, ms);
const iso = (t: number) => new Date(t).toISOString();
/** A viewer in a fixed zone, so offset values are deterministic. */
const zone = (minutesEast: number): SpanOptions => ({ zoneOffsetMinutes: () => minutesEast });
const UTC = zone(0);

function range(start: string | null, end?: string | null, opts: SpanOptions = UTC): DateRange {
  const r = dateRange(start, end, opts);
  if (!r.ok) throw new Error(`expected a range for ${start} → ${end}, got ${r.reason}`);
  return r.range;
}

describe('parseDateValue — what is a date', () => {
  it.each([
    ['1969', { precision: 'year', year: 1969 }],
    ['1969-07', { precision: 'month', year: 1969, month: 7 }],
    ['1969-07-20', { precision: 'day', year: 1969, month: 7, day: 20 }],
    ['1969-07-20T20:17', { precision: 'minute', hour: 20, minute: 17, offsetMinutes: null }],
    ['1969-07-20T20:17:40', { precision: 'second', second: 40, offsetMinutes: null }],
    ['1969-07-20T20:17:40.5', { precision: 'millisecond', millisecond: 500 }],
    ['1969-07-20T20:17:40.123', { precision: 'millisecond', millisecond: 123 }],
    ['1969-07-20T20:17Z', { precision: 'minute', offsetMinutes: 0 }],
    ['1969-07-20T20:17+05:30', { offsetMinutes: 330 }],
    ['1969-07-20T20:17-08:00', { offsetMinutes: -480 }],
    ['1969-07-20T20:17+14:00', { offsetMinutes: 840 }],
    ['  1969-07  ', { precision: 'month', month: 7 }],
  ])('%s', (raw, expected) => {
    expect(parseDateValue(raw)).toMatchObject(expected);
  });

  it('calendar values carry no offset and no clock fields', () => {
    expect(parseDateValue('1969-07-20')).toEqual({ precision: 'day', year: 1969, month: 7, day: 20, offsetMinutes: null });
  });

  it.each([
    '', '   ', '1969-7', '1969-7-20', '1969-07-2', '1969/07/20', '20-07-1969',
    '1969-00', '1969-13', '1969-07-00', '1969-07-32', '1969-02-29', '1900-02-29', '1969-04-31',
    '1969-07-20T', '1969-07-20T20', '1969-07-20T24:00', '1969-07-20T20:60', '1969-07-20T20:17:60',
    '1969-07-20T20:17:40.1234', '1969-07-20T20:17+15:00', '1969-07-20T20:17+14:01', '1969-07-20T20:17+05:60',
    '1969-07-20T20:17+0530', '1969-07-20 20:17', '1969-07-20+02:00', '1969-W29', '1969-201',
    'July 1969', '44 BC', '-0000', '-000000', '-0', '+1969-07-20x', 'NaN', '1e3', '1969.5', '1234567',
    '69-07', '-43-03-15', '12026-01-01',
  ])('%j is not a date', (raw) => {
    expect(parseDateValue(raw)).toBeNull();
  });

  it('is null for a non-string', () => {
    expect(parseDateValue(null)).toBeNull();
    expect(parseDateValue(undefined)).toBeNull();
    expect(parseDateValue(1969 as unknown as string)).toBeNull();
  });

  it('knows leap years (Gregorian, proleptic)', () => {
    expect(parseDateValue('2000-02-29')).not.toBeNull();
    expect(parseDateValue('2024-02-29')).not.toBeNull();
    expect(parseDateValue('1600-02-29')).not.toBeNull();
    expect(parseDateValue('0000-02-29')).not.toBeNull(); // year 0 is divisible by 400
    expect(parseDateValue('-0004-02-29')).not.toBeNull();
    expect(parseDateValue('2100-02-29')).toBeNull();
  });
});

describe('dateSpan — a value is the span of its own precision', () => {
  it.each([
    ['1969', U(1969), U(1970), 'year'],
    ['1969-07', U(1969, 7), U(1969, 8), 'month'],
    ['1969-12', U(1969, 12), U(1970, 1), 'month'],
    ['1969-02', U(1969, 2), U(1969, 3), 'month'],
    ['2024-02', U(2024, 2), U(2024, 3), 'month'],
    ['1969-07-20', U(1969, 7, 20), U(1969, 7, 21), 'day'],
    ['1969-12-31', U(1969, 12, 31), U(1970, 1, 1), 'day'],
    ['1969-07-20T20:17', U(1969, 7, 20, 20, 17), U(1969, 7, 20, 20, 18), 'minute'],
    ['1969-07-20T23:59', U(1969, 7, 20, 23, 59), U(1969, 7, 21), 'minute'],
    ['1969-07-20T20:17:40', U(1969, 7, 20, 20, 17, 40), U(1969, 7, 20, 20, 17, 41), 'second'],
    ['1969-07-20T20:17:40.250', U(1969, 7, 20, 20, 17, 40, 250), U(1969, 7, 20, 20, 17, 40, 251), 'millisecond'],
  ])('%s', (raw, start, end, precision) => {
    expect(dateSpan(raw, UTC)).toEqual({ start, end, precision });
  });

  it('a day is always 24h on the civil axis — no DST, whatever the viewer zone', () => {
    for (const d of ['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01']) {
      const s = dateSpan(d)!;
      expect(s.end - s.start).toBe(86_400_000);
      expect(iso(s.start)).toBe(`${d}T00:00:00.000Z`);
    }
  });

  it('a floating clock time is the wall clock as written, wherever the viewer is', () => {
    const at = U(1969, 7, 20, 20, 17);
    expect(dateSpan('1969-07-20T20:17', zone(0))!.start).toBe(at);
    expect(dateSpan('1969-07-20T20:17', zone(600))!.start).toBe(at);
    expect(dateSpan('1969-07-20T20:17', zone(-480))!.start).toBe(at);
  });

  it('a value with an offset is an instant, placed at the viewer’s wall-clock reading of it', () => {
    // 20:17 at UTC+02:00 is 18:17Z: 18:17 for a UTC viewer, 11:17 at UTC-07:00.
    expect(dateSpan('1969-07-20T20:17+02:00', zone(0))!.start).toBe(U(1969, 7, 20, 18, 17));
    expect(dateSpan('1969-07-20T20:17+02:00', zone(-420))!.start).toBe(U(1969, 7, 20, 11, 17));
    expect(dateSpan('1969-07-20T20:17Z', zone(60))!.start).toBe(U(1969, 7, 20, 21, 17));
    // Across midnight, back a day.
    expect(dateSpan('1969-07-20T01:00+05:00', zone(0))!.start).toBe(U(1969, 7, 19, 20, 0));
  });

  it('asks the zone function about the instant itself (so DST is the viewer’s at that moment)', () => {
    const asked: number[] = [];
    dateSpan('2026-07-01T12:00+02:00', { zoneOffsetMinutes: (t) => { asked.push(t); return 0; } });
    expect(asked).toEqual([Date.UTC(2026, 6, 1, 10, 0)]);
  });

  it('is null for an empty or invalid value', () => {
    expect(dateSpan('')).toBeNull();
    expect(dateSpan(null)).toBeNull();
    expect(dateSpan('1969-13')).toBeNull();
  });
});

describe('the supported year range', () => {
  it('years 0–99 are those years, not 1900–1999 (the Date.UTC trap)', () => {
    expect(iso(dateSpan('0044')!.start)).toBe('0044-01-01T00:00:00.000Z');
    expect(iso(dateSpan('0099-12-31')!.start)).toBe('0099-12-31T00:00:00.000Z');
    expect(iso(dateSpan('0001')!.start)).toBe('0001-01-01T00:00:00.000Z');
  });

  it('year 0000 is 1 BCE and negative years are astronomical (-0043 is 44 BCE)', () => {
    expect(iso(dateSpan('0000')!.start)).toBe('0000-01-01T00:00:00.000Z');
    expect(iso(dateSpan('-0001')!.end)).toBe('0000-01-01T00:00:00.000Z');
    const ides = dateSpan('-0043-03-15')!;
    expect(iso(ides.start)).toBe('-000043-03-15T00:00:00.000Z');
    expect(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', era: 'short' }).format(ides.start)).toBe('44 BC');
  });

  it('a year alone may be any integer up to six digits — what YAML makes of an unquoted year', () => {
    // `date: 0044` → 44, `date: -0043` → -43, `date: +12026` → 12026 (yaml's
    // core schema reads each as a number; the indexer stores String(n)).
    expect(parseDateValue('44')).toEqual({ precision: 'year', year: 44, offsetMinutes: null });
    expect(parseDateValue('-43')).toMatchObject({ year: -43 });
    expect(parseDateValue('12026')).toMatchObject({ year: 12026 });
    expect(parseDateValue('0')).toMatchObject({ year: 0 });
    expect(parseDateValue('7')).toMatchObject({ year: 7 });
    expect(dateSpan('-43')).toEqual(dateSpan('-0043'));
    expect(dateSpan('44')).toEqual(dateSpan('0044'));
  });

  it('a month, day or clock value needs the ISO year: four digits, or a sign and 4–6', () => {
    expect(parseDateValue('+1969')).toMatchObject({ year: 1969 });
    expect(parseDateValue('+12026-01-01')).toMatchObject({ year: 12026, precision: 'day' });
    expect(parseDateValue('-002500')).toMatchObject({ year: -2500 });
    expect(parseDateValue('-1234567')).toBeNull();
    expect(parseDateValue('-002500-06')).toMatchObject({ year: -2500, month: 6 });
    expect(parseDateValue('+1969-07-20T20:17')).toMatchObject({ year: 1969, precision: 'minute' });
    expect(iso(dateSpan('+12026')!.start)).toBe('+012026-01-01T00:00:00.000Z');
  });

  it('ends where JS Date ends: -271820 to 275759 as whole years', () => {
    expect(dateSpan('-271820')).not.toBeNull();
    expect(dateSpan('-271821')).toBeNull(); // starts before -271821-04-20
    expect(dateSpan('-271821-04-20')).not.toBeNull(); // the first day Date can hold
    expect(dateSpan('-271821-04-19')).toBeNull();
    expect(dateSpan('+275759')).not.toBeNull();
    expect(dateSpan('+275760')).toBeNull(); // would end in 275761
    expect(dateSpan('+275760-09-12')).not.toBeNull(); // ends exactly at Date's max
    expect(dateSpan('+275760-09-13')).toBeNull();
    expect(dateSpan('+275760-09-12')!.end).toBe(MAX_CIVIL_MS);
  });

  it('is proleptic Gregorian: October 1582 has 31 days, not 21', () => {
    const oct = dateSpan('1582-10')!;
    expect((oct.end - oct.start) / 86_400_000).toBe(31);
    expect(parseDateValue('1582-10-10')).not.toBeNull();
  });
});

describe('dateRange — a start and an optional end', () => {
  it('without an end, the range is the start’s own span', () => {
    expect(range('1969')).toEqual({
      start: U(1969), end: U(1970), startSpan: { start: U(1969), end: U(1970), precision: 'year' }, endSpan: null, endIssue: null,
    });
    expect(range('1969-07-20', '')).toMatchObject({ start: U(1969, 7, 20), end: U(1969, 7, 21), endIssue: null });
    expect(range('1969-07-20', '   ')).toMatchObject({ endIssue: null });
    expect(range('1969-07-20', null)).toMatchObject({ endIssue: null });
  });

  it.each([
    // [start, end, rangeStart, rangeEnd]
    ['1969-07-16', '1969-07-24', U(1969, 7, 16), U(1969, 7, 25)], // a calendar end is inclusive of its day
    ['1969-07-20', '1970', U(1969, 7, 20), U(1971)], // an end coarser than its start runs to the end of its own span
    ['1969-07-20', '1969-12', U(1969, 7, 20), U(1970)],
    ['1969', '1972', U(1969), U(1973)],
    ['1969-07', '1969-07', U(1969, 7), U(1969, 8)], // same value: the start’s span
    ['1969-07-20', '1969-07-20', U(1969, 7, 20), U(1969, 7, 21)],
    ['1969', '1969-03', U(1969), U(1969, 4)], // an end inside the start’s span narrows it
    ['1969-07-20', '1969', U(1969, 7, 20), U(1970)], // a coarse end that contains the start
    ['1969-07-20T14:30', '1969-07-20T16:00', U(1969, 7, 20, 14, 30), U(1969, 7, 20, 16)], // a clock end is the instant itself
    ['1969-07-20', '1969-07-20T16:00', U(1969, 7, 20), U(1969, 7, 20, 16)],
    ['1969-07-20T14:30', '1969-07-21', U(1969, 7, 20, 14, 30), U(1969, 7, 22)],
    ['1969-07-20T14:30', '1969-07-20T14:30:01', U(1969, 7, 20, 14, 30), U(1969, 7, 20, 14, 30, 1)],
    ['-0043-03-15', '-0042', U(-43, 3, 15), U(-41)],
    ['-0001', '0001', U(-1), U(2)], // across 1 BCE → 1 CE, through year 0
  ])('%s → %s', (start, end, rStart, rEnd) => {
    const r = range(start, end);
    expect([iso(r.start), iso(r.end)]).toEqual([iso(rStart), iso(rEnd)]);
    expect(r.endIssue).toBeNull();
    expect(r.endSpan).toEqual(dateSpan(end, UTC));
    expect(r.startSpan).toEqual(dateSpan(start, UTC));
  });

  it.each([
    ['1970', '1969'],
    ['1970', '1969-12-31'], // ends exactly where the start begins
    ['1969-07-20', '1969-07-19'],
    ['1969-07-20T14:30', '1969-07-20T14:30'], // a zero-length clock range
    ['1969-07-20T14:30', '1969-07-20T09:00'],
    ['1969-07-20T14:30', '1969-07-20T14:29:59.999'],
    ['0001', '-0001'],
  ])('%s → %s: an end before the start is set aside, not swapped', (start, end) => {
    const r = range(start, end);
    expect(r.endIssue).toBe('before-start');
    expect(r.endSpan).toBeNull();
    const own = dateSpan(start, UTC)!;
    expect([r.start, r.end]).toEqual([own.start, own.end]);
  });

  it('an end that isn’t a date is set aside; the start survives', () => {
    const r = range('1969-07-20', 'soon');
    expect(r).toMatchObject({ start: U(1969, 7, 20), end: U(1969, 7, 21), endSpan: null, endIssue: 'invalid' });
  });

  it('without a start there is no range: missing vs. not a date', () => {
    expect(dateRange(null)).toEqual({ ok: false, reason: 'missing' });
    expect(dateRange(undefined, '1970')).toEqual({ ok: false, reason: 'missing' });
    expect(dateRange('  ', '1970')).toEqual({ ok: false, reason: 'missing' });
    expect(dateRange('July 1969', '1970')).toEqual({ ok: false, reason: 'invalid' });
    expect(dateRange('1969-02-30')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('offset values in a range compare as instants', () => {
    // 09:00 in New York (-05:00) is 14:00Z; ending at 15:30+01:00 is also 14:30Z.
    const r = range('2026-01-05T09:00-05:00', '2026-01-05T15:30+01:00', UTC);
    expect([iso(r.start), iso(r.end)]).toEqual(['2026-01-05T14:00:00.000Z', '2026-01-05T14:30:00.000Z']);
    // …and a later wall-clock reading in another zone can still be before the start.
    expect(range('2026-01-05T09:00-05:00', '2026-01-05T14:30+02:00', UTC).endIssue).toBe('before-start');
  });

  it('every range ends after it starts', () => {
    const values = ['1969', '1969-07', '1969-07-20', '1969-07-20T20:17', '1970', '1968-12-31', '1969-07-20T20:17:01', 'x', ''];
    for (const a of values) for (const b of values) {
      const r = dateRange(a, b, UTC);
      if (r.ok) expect(r.range.end).toBeGreaterThan(r.range.start);
    }
  });
});

describe('precision helpers', () => {
  it('orders precisions coarsest first and tells clock from calendar', () => {
    expect(PRECISION_ORDER).toEqual(['year', 'month', 'day', 'minute', 'second', 'millisecond']);
    expect(PRECISION_ORDER.filter(isClockPrecision)).toEqual(['minute', 'second', 'millisecond']);
  });
});

/**
 * Range filters (#2533) used to compare lexically; since #2613 a `date` /
 * `datetime` filter compares spans (`view-spec.ts` → `dateValueInRange`). For
 * unsigned four-digit years at calendar precision the old lexical rule was
 * exactly "the value's span starts within [span(min).start, span(max).end)",
 * so this table — written against the lexical rule — must still hold: the
 * move changed nothing for ordinary dates.
 */
describe('agrees with the range filter for four-digit calendar dates', () => {
  const values = ['1968', '1969', '1969-01', '1969-06', '1969-07', '1969-07-01', '1969-07-19', '1969-07-20', '1969-07-31', '1969-08', '1969-12-31', '1970', '1970-01-01'];
  const bounds = [null, '1969', '1969-07', '1969-07-20', '1969-12', '1970'];
  const inSpanTerms = (v: string, min: string | null, max: string | null) => {
    const s = dateSpan(v)!.start;
    return (min === null || s >= dateSpan(min)!.start) && (max === null || s < dateSpan(max)!.end);
  };
  for (const min of bounds) for (const max of bounds) {
    it(`min ${min ?? '—'} / max ${max ?? '—'}`, () => {
      for (const v of values) {
        const lexical = matchesFilter({ path: 'n.md', title: 'n', values: { date: v } }, { property: 'date', min, max }, 'date');
        expect(lexical, v).toBe(inSpanTerms(v, min, max));
      }
    });
  }
});

/**
 * The `datetime` property type (#2613) accepts exactly what this parser
 * reads: a clock time, local unless an offset is written, and every date-only
 * or partial value `date` accepts — each meaning its whole span — so a
 * property can move from `date` to `datetime` without invalidating a note.
 */
describe('datetime property values (#2613): precision and zone', () => {
  it.each([
    // date-only and partial: the span of their precision, no zone
    ['2026-10-05', 'day', null, U(2026, 10, 5), U(2026, 10, 6)],
    ['2026-10', 'month', null, U(2026, 10), U(2026, 11)],
    ['2026', 'year', null, U(2026), U(2027)],
    ['-43', 'year', null, U(-43), U(-42)],
    // local (floating): the wall clock, whatever the viewer's zone
    ['2026-10-05T14:30', 'minute', null, U(2026, 10, 5, 14, 30), U(2026, 10, 5, 14, 31)],
    ['2026-10-05T14:30:15', 'second', null, U(2026, 10, 5, 14, 30, 15), U(2026, 10, 5, 14, 30, 16)],
    // offset: an instant, here read by a UTC viewer
    ['2026-10-05T14:30Z', 'minute', 0, U(2026, 10, 5, 14, 30), U(2026, 10, 5, 14, 31)],
    ['2026-10-05T14:30+02:00', 'minute', 120, U(2026, 10, 5, 12, 30), U(2026, 10, 5, 12, 31)],
    ['2026-10-05T23:30-05:00', 'minute', -300, U(2026, 10, 6, 4, 30), U(2026, 10, 6, 4, 31)],
  ])('%s → %s, offset %s', (raw, precision, offset, start, end) => {
    expect(parseDateValue(raw)).toMatchObject({ precision, offsetMinutes: offset });
    expect(dateSpan(raw, UTC)).toEqual({ start, end, precision });
  });

  it('a floating time is the same for every viewer; an offset one moves with the viewer', () => {
    for (const minutes of [-480, 0, 330, 840]) {
      expect(dateSpan('2026-10-05T14:30', zone(minutes))!.start).toBe(U(2026, 10, 5, 14, 30));
    }
    expect(dateSpan('2026-10-05T14:30Z', zone(330))!.start).toBe(U(2026, 10, 5, 20, 0));
  });

  it.each(['2026-10-05T14', '2026-10-05T14:30:60', '2026-10-05T14:30+15:00', '2026-10-05 14:30', '2026-10-05T2:30', '14:30', 'Oct 5 2026 2:30pm'])(
    '%j is invalid',
    (raw) => { expect(parseDateValue(raw)).toBeNull(); },
  );
});

/** Where span comparison and the old lexical rule part ways (#2613). */
describe('range filters compare spans: signed years and mixed offsets (#2613)', () => {
  const match = (v: string, min: string | null, max: string | null, type: 'date' | 'datetime' = 'datetime') =>
    matchesFilter({ path: 'n.md', title: 'n', values: { when: v } }, { property: 'when', min, max }, type, UTC);

  it('orders signed and short years by time, for date and datetime', () => {
    for (const type of ['date', 'datetime'] as const) {
      expect(match('-43', '-0100', '-0001', type)).toBe(true); // lexically '-43' < '-0100' is false…
      expect(match('-0043-03-15', '-0044', '-0043', type)).toBe(true);
      expect(match('44', '0001', '0099', type)).toBe(true); // '44' > '0099' as strings
      expect(match('12026', '2000', '9999', type)).toBe(false); // '12026' < '9999' as strings
    }
  });

  it('compares mixed offsets as instants', () => {
    // 23:30-05:00 is 04:30Z on the 6th: lexically before a 01:00Z max, really after it.
    expect(match('2026-10-05T23:30-05:00', null, '2026-10-06T01:00Z')).toBe(false);
    expect(match('2026-10-06T03:00+05:00', '2026-10-05T23:00Z', null)).toBe(false);
    expect(match('2026-10-06T00:30+02:00', '2026-10-05T22:00Z', '2026-10-05T23:00Z')).toBe(true);
  });

  it('keeps a whole bound span, down to the minute', () => {
    expect(match('2026-10-05T14:30:59', '2026-10-05T14:30', '2026-10-05T14:30')).toBe(true);
    expect(match('2026-10-05T23:59', '2026-10-05', '2026-10-05')).toBe(true);
    expect(match('2026-10-06T00:00', '2026-10-05', '2026-10-05')).toBe(false);
  });

  it('falls back to the lexical rule when a value or bound isn\'t a date', () => {
    // Neither '2026-5-14' nor 'next year' parses, so these are the old string comparisons.
    expect(match('2026-5-14', '2026-05', '2026-06')).toBe(false); // '2026-5' > '2026-06' as strings
    expect(match('2026-05-14', '2026-05', 'next year')).toBe(true); // '2026-05-14' <= 'next year' as strings
  });
});
