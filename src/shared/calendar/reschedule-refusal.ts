/**
 * Whether a calendar event can be rescheduled, and the sentence when it can't
 * (#2703). Shared since #2929: the Calendar plugin refuses a drag with it, and
 * the type view's row menu shows *Move to date…* disabled with the same
 * sentence, so the two can't disagree. The rule is `date-shift.ts`'s, the
 * words `reschedule-text.ts`'s. `timeRefusalFor` (#2953) is the same for a
 * move or resize by time in the Week and Day grids.
 */
import { rescheduleRefusal, resizeRefusal, retimeRefusal } from '../objects/date-shift';
import { noEndText, rescheduleRefusalText } from '../objects/reschedule-text';
import type { TimelineEvent, TimelineProperties } from '../timeline/timeline-events';

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

/** Why `ev` can't be moved by time (`move`) or have its end changed (`resize`) (#2953); null when it can. */
export function timeRefusalFor(ev: Pick<TimelineEvent, 'inst' | 'title'>, dates: TimelineProperties, kind: 'move' | 'resize'): string | null {
  const { start, end } = writtenDates(ev, dates);
  if (kind === 'resize' && dates.endProperty === null) return noEndText(ev.title);
  const reason = kind === 'move' ? retimeRefusal(start, end) : resizeRefusal(start);
  return reason === null ? null : rescheduleRefusalText(reason, { title: ev.title, start, end });
}
