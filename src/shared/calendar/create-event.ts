/**
 * A new event drawn on the calendar (#2954, epic #2949): the stretch the
 * Week and Day grids send with `view.createEvent`, and the values written.
 * Pure, so the plugin, the broker and the host agree on what's valid.
 *
 * - **A stretch is a day, a run of days, or a time range on one clock.** The
 *   start is a day (`2026-10-07`) or a time to the minute with no offset
 *   (`2026-10-07T09:00`): what the grid drew is the viewer's wall clock, so
 *   a floating time says exactly that. The end is null, or the same
 *   precision and later: the last day of a run (`end` is inclusive for a
 *   day, as everywhere in the calendar) or the time it ends.
 * - **A date property gets a date.** Where the view's *Date by* is a `date`
 *   property rather than a `datetime`, a time range is written as its day:
 *   the property can't hold a time.
 */
import { formatDayAnchor } from '../objects/calendar-grid';
import { parseDateValue, spanOfParsed } from '../objects/date-precision';
import { DAY_MS } from '../time';

/** The longest stretch one creation may cover, in days. */
export const CREATE_EVENT_MAX_DAYS = 366;

/** Why `start`/`end` isn't a stretch a calendar may create (a sentence for the plugin's author), or null. */
export function createEventRefusal(start: string, end: string | null): string | null {
  const s = parseDateValue(start);
  if (!s || (s.precision !== 'day' && s.precision !== 'minute') || s.offsetMinutes !== null || start.trim() !== start) {
    return '"start" is a day (2026-10-07) or a time to the minute with no offset (2026-10-07T09:00).';
  }
  if (end === null) return null;
  const e = parseDateValue(end);
  if (!e || e.precision !== s.precision || e.offsetMinutes !== null || end.trim() !== end) return '"end" is null, or the same precision as "start".';
  const from = spanOfParsed(s)!.start;
  const to = spanOfParsed(e)!.start;
  if (to <= from) return '"end" is after "start".';
  if (to - from > CREATE_EVENT_MAX_DAYS * DAY_MS) return `A new event spans at most ${CREATE_EVENT_MAX_DAYS} days.`;
  return null;
}

/** A day, or a time on it (`minute` past midnight), as `createEvent` sends it. */
export function eventValue(day: number, minute: number | null = null): string {
  if (minute === null) return formatDayAnchor(day);
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${formatDayAnchor(day)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** The values to write for a property of `propertyType`: a `date` keeps only the day. */
export function valuesFor(propertyType: string | undefined, start: string, end: string | null): { start: string; end: string | null } {
  if (propertyType !== 'date') return { start, end };
  const day = (v: string) => v.slice(0, v.indexOf('T') === -1 ? v.length : v.indexOf('T'));
  const s = day(start);
  const e = end === null ? null : day(end);
  return { start: s, end: e === null || e === s ? null : e };
}
