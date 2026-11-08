/**
 * The stretch a calendar may create an event over (#2954): a day, a run of
 * days, or a time range on one wall clock; and a `date` property keeps only
 * the day.
 */
import { describe, it, expect } from 'vitest';
import { CREATE_EVENT_MAX_DAYS, createEventRefusal, eventValue, valuesFor } from '../../../src/shared/calendar/create-event';
import { civilMs } from '../../../src/shared/objects/date-precision';

describe('createEventRefusal', () => {
  it('accepts a day, a run of days, a time, and a time range', () => {
    expect(createEventRefusal('2026-10-07', null)).toBeNull();
    expect(createEventRefusal('2026-10-07', '2026-10-09')).toBeNull();
    expect(createEventRefusal('2026-10-07T09:00', null)).toBeNull();
    expect(createEventRefusal('2026-10-07T23:30', '2026-10-08T00:00')).toBeNull();
  });

  it('refuses an offset, seconds, a coarse or mixed precision, an end not after the start, and too long a stretch', () => {
    expect(createEventRefusal('2026-10-07T09:00Z', null)).toMatch(/no offset/);
    expect(createEventRefusal('2026-10-07T09:00:00', null)).toMatch(/to the minute/);
    expect(createEventRefusal('2026-10', null)).not.toBeNull();
    expect(createEventRefusal(' 2026-10-07', null)).not.toBeNull();
    expect(createEventRefusal('2026-10-07', '2026-10-07T10:00')).toMatch(/same precision/);
    expect(createEventRefusal('2026-10-07T10:00', '2026-10-07T10:00')).toMatch(/after/);
    expect(createEventRefusal('2026-10-07', '2026-10-06')).toMatch(/after/);
    expect(createEventRefusal('2026-01-01', '2027-06-01')).toMatch(String(CREATE_EVENT_MAX_DAYS));
  });
});

describe('eventValue and valuesFor', () => {
  it('writes a day, or a time on it', () => {
    const day = civilMs(2026, 9, 7);
    expect(eventValue(day)).toBe('2026-10-07');
    expect(eventValue(day, 9 * 60 + 5)).toBe('2026-10-07T09:05');
  });

  it('a date property keeps only the day; a datetime keeps it all', () => {
    expect(valuesFor('date', '2026-10-07T09:00', '2026-10-07T10:00')).toEqual({ start: '2026-10-07', end: null });
    expect(valuesFor('date', '2026-10-07', '2026-10-09')).toEqual({ start: '2026-10-07', end: '2026-10-09' });
    expect(valuesFor('datetime', '2026-10-07T09:00', '2026-10-07T10:00')).toEqual({ start: '2026-10-07T09:00', end: '2026-10-07T10:00' });
  });
});
