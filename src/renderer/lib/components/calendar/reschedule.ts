/**
 * The Calendar's side of a reschedule (#2703) that isn't drawing: what an
 * event's written dates are, whether it can move (and the sentence when it
 * can't), and reading a typed *Move to date…* day. Pure, so it tests without
 * a DOM; the rule itself is `shared/objects/date-shift.ts`'s and the write is
 * the `kanban-moves` store's.
 */
import { rescheduleRefusal, startDayOf } from '../../../../shared/objects/date-shift';
import { rescheduleRefusalText } from '../../../../shared/objects/reschedule-text';
import { civilMs, parseDateValue } from '../../../../shared/objects/date-precision';
import type { TimelineEvent, TimelineProperties } from '../timeline/timeline-events';

/** The day list's event-menu hooks (#2703). */
export interface DayListMenu {
  /** Why the event can't be rescheduled, or null. */
  refusal: (key: string) => string | null;
  /** *Move to date…* (also on a refused event, to say why again). */
  onMoveToDate: (key: string) => void;
}

function text(v: string | null | undefined): string | null {
  return v === null || v === undefined || v.trim() === '' ? null : v.trim();
}

/** An event's start and end as the index read them (the view's *Date by* and, for Event, `end`). */
export function writtenDates(ev: Pick<TimelineEvent, 'inst'>, dates: TimelineProperties): { start: string; end: string | null } {
  return {
    start: text(ev.inst.values[dates.dateProperty]) ?? '',
    end: dates.endProperty === null ? null : text(ev.inst.values[dates.endProperty]),
  };
}

/** Why `ev` can't be rescheduled, as the live region says it; null when it can. */
export function refusalFor(ev: Pick<TimelineEvent, 'inst' | 'title'>, dates: TimelineProperties): string | null {
  const { start, end } = writtenDates(ev, dates);
  const reason = rescheduleRefusal(start, end);
  return reason === null ? null : rescheduleRefusalText(reason, { title: ev.title, start, end });
}

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
