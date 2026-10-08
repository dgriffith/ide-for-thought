/**
 * The Calendar's reschedule helpers (#2703): an event's written dates,
 * whether it can move and the sentence when it can't (decision 5 on #2699),
 * the day *Move to date…* counts from, and a typed target day. The day maths
 * itself is `date-shift.ts`'s, tested there.
 */
import { describe, it, expect } from 'vitest';
import { eventStartDay, parseTypedDay, refusalFor, writtenDates } from '../../../../src/renderer/lib/components/calendar/reschedule';
import { rescheduleRefusalText } from '../../../../src/shared/objects/reschedule-text';
import { civilMs } from '../../../../src/shared/objects/date-precision';

const DATES = { dateProperty: 'date', endProperty: 'end' };
const ev = (date: string | null, end: string | null = null, title = 'Trip') =>
  ({ title, inst: { path: 'x.md', title, values: { date, end }, cover: null } });

describe('reschedule helpers', () => {
  it('reads the written start and end (trimmed), and only the view\'s end property', () => {
    expect(writtenDates(ev(' 2026-10-09 ', '2026-10-14'), DATES)).toEqual({ start: '2026-10-09', end: '2026-10-14' });
    expect(writtenDates(ev('2026-10-09', '2026-10-14'), { dateProperty: 'date', endProperty: null })).toEqual({ start: '2026-10-09', end: null });
    expect(writtenDates(ev('2026-10-09', ''), DATES).end).toBeNull();
  });

  it('a day or clock event can move; a month or year start or end says why', () => {
    expect(refusalFor(ev('2026-10-09', '2026-10-14'), DATES)).toBeNull();
    expect(refusalFor(ev('2026-10-09T09:00Z', 'not a date'), DATES)).toBeNull(); // an unreadable end is left alone
    expect(refusalFor(ev('1969-07'), DATES)).toBe('1969-07 has no day to move; open it to edit.');
    expect(refusalFor(ev('1969'), DATES)).toBe('1969 has no day to move; open it to edit.');
    expect(refusalFor(ev('2026-10-20', '2026-11', 'Launch'), DATES)).toBe('Launch ends 2026-11, which has no day to move; open it to edit.');
  });

  it('every refusal has a sentence', () => {
    const e = { title: 'Trip', start: '2026-10-09', end: null };
    expect(rescheduleRefusalText('invalid', e)).toBe('Trip has no date to move.');
    expect(rescheduleRefusalText('out-of-range', e)).toBe('Trip can’t move that far.');
  });

  it('counts from the day the start shows on', () => {
    expect(eventStartDay(ev('2026-10-09T23:30'), DATES)).toBe(civilMs(2026, 9, 9));
    expect(eventStartDay(ev('1969-07'), DATES)).toBeNull();
  });

  it('a typed day: a date or a date-time (its day), never a month or year or nonsense', () => {
    expect(parseTypedDay(' 2026-11-03 ')).toBe(civilMs(2026, 10, 3));
    expect(parseTypedDay('2028-02-29T10:00')).toBe(civilMs(2028, 1, 29));
    expect(parseTypedDay('2026-11')).toBeNull();
    expect(parseTypedDay('2026')).toBeNull();
    expect(parseTypedDay('2026-02-30')).toBeNull();
    expect(parseTypedDay('next tuesday')).toBeNull();
  });
});
