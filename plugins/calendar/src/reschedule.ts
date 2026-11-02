/**
 * The Calendar's side of a reschedule (#2703) that isn't drawing: the day
 * *Move to date…* counts from, and reading a typed day. Pure, so it tests
 * without a DOM. Whether an event can move, and the sentence when it can't,
 * is `shared/calendar/reschedule-refusal.ts`'s since #2929 (Minerva's row
 * menu says it too); the write is the `kanban-moves` store's.
 */
import { startDayOf } from '../../../src/shared/objects/date-shift';
import { writtenDates } from '../../../src/shared/calendar/reschedule-refusal';
import { civilMs, parseDateValue } from '../../../src/shared/objects/date-precision';
import type { TimelineEvent, TimelineProperties } from '../../../src/shared/timeline/timeline-events';

export { refusalFor, writtenDates } from '../../../src/shared/calendar/reschedule-refusal';

/** The civil day the event's start shows on for this viewer (what *Move to date…* counts from). */
export function eventStartDay(ev: Pick<TimelineEvent, 'inst'>, dates: TimelineProperties): number | null {
  return startDayOf(writtenDates(ev, dates).start);
}

/**
 * A typed target day: any value `parseDateValue` reads to a day or finer
 * (`2026-10-12`, `2026-10-12T09:00` — only the day counts). Null for anything
 * else, a month or year included: a move needs a day.
 */
export function parseTypedDay(raw: string): number | null {
  const p = parseDateValue(raw.trim());
  if (!p || p.month === undefined || p.day === undefined) return null;
  return civilMs(p.year, p.month - 1, p.day);
}
