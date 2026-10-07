/**
 * `date` / `datetime` values in the object system (#2613): display, sort,
 * range and graph typing, all read through the #2611 parser.
 */
import { describe, it, expect } from 'vitest';
import {
  compareDateValues, dateValueInRange, formatDateValue, isDateType, xsdDateLiteral,
} from '../../../src/shared/objects/date-values';
import type { SpanOptions } from '../../../src/shared/objects/date-precision';

/** A viewer in a fixed zone, so offset values are deterministic. */
const zone = (minutesEast: number): SpanOptions => ({ zoneOffsetMinutes: () => minutesEast });
const UTC = zone(0);
const en = { locale: 'en-US', ...UTC };

describe('isDateType', () => {
  it('is date and datetime only', () => {
    expect(isDateType('date')).toBe(true);
    expect(isDateType('datetime')).toBe(true);
    expect(isDateType('text')).toBe(false);
    expect(isDateType(undefined)).toBe(false);
  });
});

describe('formatDateValue — locale-formatted at the value\'s own precision', () => {
  it.each([
    ['1969', '1969'],
    ['1969-07', 'Jul 1969'],
    ['1969-07-20', 'Jul 20, 1969'],
    ['1969-07-20T20:17', 'Jul 20, 1969, 8:17 PM'],
    ['1969-07-20T20:17:00', 'Jul 20, 1969, 8:17 PM'], // :00 seconds aren't shown
    ['1969-07-20T20:17:40', 'Jul 20, 1969, 8:17:40 PM'],
    ['1969-07-20T20:17:40.5', 'Jul 20, 1969, 8:17:40 PM'],
    ['2026-10-05T14:30Z', 'Oct 5, 2026, 2:30 PM'],
    ['12026', '12026'],
  ])('%s → %s', (raw, shown) => {
    expect(formatDateValue(raw, en).replace(/\u202f/g, ' ')).toBe(shown);
  });

  it('shows a time only when the value has one', () => {
    expect(formatDateValue('2026-10-05', en)).not.toMatch(/\d:\d\d/);
    expect(formatDateValue('2026-10-05T09:05', en)).toMatch(/9:05/);
  });

  it('shows BCE with an era, through Intl', () => {
    expect(formatDateValue('-0043', en)).toBe('44 BC');
    expect(formatDateValue('-43', en)).toBe('44 BC'); // YAML's reading of `date: -0043`
    expect(formatDateValue('0000', en)).toBe('1 BC');
    expect(formatDateValue('-0043-03-15', en)).toBe('Mar 15, 44 BC');
  });

  it('places an offset value at the viewer\'s wall clock; a floating one stays put', () => {
    const tokyo = { locale: 'en-US', ...zone(540) };
    expect(formatDateValue('2026-10-05T14:30Z', tokyo).replace(/\u202f/g, ' ')).toBe('Oct 5, 2026, 11:30 PM');
    expect(formatDateValue('2026-10-05T14:30', tokyo).replace(/\u202f/g, ' ')).toBe('Oct 5, 2026, 2:30 PM');
  });

  it('follows the locale', () => {
    expect(formatDateValue('2026-10-05', { locale: 'de-DE' })).toBe('5. Okt. 2026');
  });

  it('shows a value that isn\'t a date as written', () => {
    expect(formatDateValue('soon', en)).toBe('soon');
    expect(formatDateValue('1969-02-30', en)).toBe('1969-02-30');
  });
});

describe('compareDateValues — by span, not by string', () => {
  const sorted = (values: string[], opts: SpanOptions = UTC) => [...values].sort((a, b) => compareDateValues(a, b, opts));

  it('orders signed and long years by time', () => {
    expect(sorted(['12026', '2026', '0044', '-0043', '-43', '1969-07'])).toEqual(['-0043', '-43', '0044', '1969-07', '2026', '12026']);
  });

  it('orders values within a day by their time; a date-only value sorts at its day\'s start', () => {
    expect(sorted(['2026-10-05T14:30', '2026-10-05T09:00', '2026-10-05', '2026-10-04T23:59'])).toEqual([
      '2026-10-04T23:59', '2026-10-05', '2026-10-05T09:00', '2026-10-05T14:30',
    ]);
  });

  it('orders a narrower span first when two start together', () => {
    expect(sorted(['1969', '1969-01', '1969-01-01'])).toEqual(['1969-01-01', '1969-01', '1969']);
  });

  it('orders mixed offsets by instant', () => {
    // 23:30 at -05:00 is 04:30Z the next day: later than 01:00Z, though it sorts first as a string.
    expect(sorted(['2026-10-05T23:30-05:00', '2026-10-06T01:00Z'])).toEqual(['2026-10-06T01:00Z', '2026-10-05T23:30-05:00']);
  });

  it('puts values that aren\'t dates last, as text', () => {
    expect(sorted(['tbd', '2026', 'soon', '1969'])).toEqual(['1969', '2026', 'soon', 'tbd']);
  });
});

describe('dateValueInRange — the value\'s span start in [span(min).start, span(max).end)', () => {
  it('is inclusive of a bound\'s whole span', () => {
    expect(dateValueInRange('2026-05-31T23:59', null, '2026-05', UTC)).toBe(true);
    expect(dateValueInRange('2026-06-01T00:00', null, '2026-05', UTC)).toBe(false);
    expect(dateValueInRange('2026-10-05T14:30:30', null, '2026-10-05T14:30', UTC)).toBe(true);
    expect(dateValueInRange('2026-10-05T14:31', null, '2026-10-05T14:30', UTC)).toBe(false);
    expect(dateValueInRange('2026-05-01', '2026-05', null, UTC)).toBe(true);
    expect(dateValueInRange('2026-04-30T23:59', '2026-05', null, UTC)).toBe(false);
  });

  it('compares across offsets as instants', () => {
    // 23:30-05:00 is 04:30Z on the 6th — after a 01:00Z max, though lexically before it.
    expect(dateValueInRange('2026-10-05T23:30-05:00', null, '2026-10-06T01:00Z', UTC)).toBe(false);
    expect(dateValueInRange('2026-10-06T03:00+05:00', '2026-10-05T23:00Z', null, UTC)).toBe(false);
    expect(dateValueInRange('2026-10-06T03:00+02:00', '2026-10-05T23:00Z', '2026-10-06T01:00Z', UTC)).toBe(true);
  });

  it('compares signed and long years by time', () => {
    expect(dateValueInRange('-0043', '-0100', '0099', UTC)).toBe(true);
    expect(dateValueInRange('-43', '-0100', '-0050', UTC)).toBe(false);
    expect(dateValueInRange('-0043-03-15', '-0044', '-0043', UTC)).toBe(true);
    expect(dateValueInRange('12026', '9000', null, UTC)).toBe(true);
    expect(dateValueInRange('0044', '1000', null, UTC)).toBe(false);
  });

  it('is open at an absent or empty bound', () => {
    expect(dateValueInRange('1969', null, undefined, UTC)).toBe(true);
    expect(dateValueInRange('1969', '', '', UTC)).toBe(true);
  });

  it('is null when the value or a bound isn\'t a date', () => {
    expect(dateValueInRange('soon', '2026', null, UTC)).toBeNull();
    expect(dateValueInRange('2026-05', '2026-5', null, UTC)).toBeNull();
    expect(dateValueInRange('2026-05', null, 'May', UTC)).toBeNull();
  });
});

describe('xsdDateLiteral — the graph literal', () => {
  it.each([
    ['1969', '1969', 'gYear'],
    ['-43', '-0043', 'gYear'], // YAML hands `date: -0043` over as the number -43
    ['-0043', '-0043', 'gYear'],
    ['44', '0044', 'gYear'],
    ['0', '0000', 'gYear'],
    ['+12026', '12026', 'gYear'],
    ['1969-07', '1969-07', 'gYearMonth'],
    ['-0043-03', '-0043-03', 'gYearMonth'],
    ['1969-07-20', '1969-07-20', 'date'],
    ['-0043-03-15', '-0043-03-15', 'date'],
    ['+12026-01-01', '12026-01-01', 'date'],
    ['2026-10-05T14:30', '2026-10-05T14:30:00', 'dateTime'],
    ['2026-10-05T14:30:15', '2026-10-05T14:30:15', 'dateTime'],
    ['2026-10-05T14:30:15.5', '2026-10-05T14:30:15.500', 'dateTime'],
    ['2026-10-05T14:30Z', '2026-10-05T14:30:00Z', 'dateTime'],
    ['2026-10-05T14:30+00:00', '2026-10-05T14:30:00Z', 'dateTime'],
    ['2026-10-05T14:30+05:30', '2026-10-05T14:30:00+05:30', 'dateTime'],
    ['2026-10-05T14:30-08:00', '2026-10-05T14:30:00-08:00', 'dateTime'],
    ['-0043-03-15T10:00', '-0043-03-15T10:00:00', 'dateTime'],
  ])('%s → "%s"^^xsd:%s', (raw, lexical, datatype) => {
    expect(xsdDateLiteral(raw)).toEqual({ lexical, datatype });
  });

  it.each(['', 'soon', '1969-02-30', '2026-10-05T24:00', '2026-10-05 14:30', '1969-7'])('%j is not a date literal', (raw) => {
    expect(xsdDateLiteral(raw)).toBeNull();
  });
});
