/**
 * A calendar's reschedule, Minerva's half (#2829): the Calendar plugin asks
 * for a note and a day count (`view.reschedule`), and the type view runs the
 * move store's `rescheduleEvent` with the view's *Date by* (and Event's
 * `end`), the days named for the announcements, and Local History's cause.
 * The plugin's half is tests/plugins/calendar/CalendarReschedule.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { rescheduleInView } from '../../../src/renderer/lib/components/type-view/calendar-reschedule';
import type { PropertyDef, TypeInstanceRow } from '../../../src/shared/objects/type-def';

const EVENT: PropertyDef[] = [{ name: 'date', type: 'datetime' }, { name: 'end', type: 'datetime' }, { name: 'announced', type: 'date' }];
const trip: TypeInstanceRow = { path: 'trip.md', title: 'Trip', values: { date: '2026-10-09', end: '2026-10-14', announced: '2026-01-02' }, cover: null };
const store = () => ({ rescheduleEvent: vi.fn(async () => ({ ok: true as const, paths: [] })) }) as unknown as Parameters<typeof rescheduleInView>[0] & { rescheduleEvent: ReturnType<typeof vi.fn> };

describe('rescheduleInView', () => {
  it('moves the start and Event\'s end by the days asked, naming the days, as the plugin', () => {
    const moves = store();
    rescheduleInView(moves, trip, { properties: EVENT, dateBy: null, cause: 'Moved by Calendar', locale: 'en-GB' }, 2);
    expect(moves.rescheduleEvent).toHaveBeenCalledWith(
      { path: 'trip.md', title: 'Trip' }, { start: 'date', end: 'end' }, 2,
      { to: expect.stringContaining('11 October 2026'), back: expect.stringContaining('9 October 2026') },
      { cause: 'Moved by Calendar' },
    );
  });

  it('dated by another property: that one moves, alone', () => {
    const moves = store();
    rescheduleInView(moves, trip, { properties: EVENT, dateBy: 'announced', locale: 'en-GB' }, -1);
    expect(moves.rescheduleEvent).toHaveBeenCalledWith(
      expect.anything(), { start: 'announced', end: null }, -1, { to: expect.stringContaining('1 January 2026'), back: expect.anything() }, {},
    );
  });

  it('asks nothing for no days, a fraction, or a note with no day to count from', () => {
    const moves = store();
    rescheduleInView(moves, trip, { properties: EVENT, dateBy: null }, 0);
    rescheduleInView(moves, trip, { properties: EVENT, dateBy: null }, 1.5);
    rescheduleInView(moves, { ...trip, values: { date: null, end: null, announced: null } }, { properties: EVENT, dateBy: null }, 3);
    expect(moves.rescheduleEvent).not.toHaveBeenCalled();
  });
});
