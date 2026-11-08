/**
 * What the Calendar says when it won't reschedule an event (#2703, decision 5
 * on #2699) — one sentence per `RescheduleRefusal` (`date-shift.ts`), spoken
 * through the live region on a refused drag or *Move to date…*, and shown in
 * the event's menu in place of the move. Pure, so the store and the grid say
 * exactly the same thing.
 */
import type { RescheduleRefusal } from './date-shift';

export interface RefusedEvent {
  title: string;
  /** The start and end as written. */
  start: string;
  end: string | null;
}

/** "1969-07 has no day to move; open it to edit." */
export function rescheduleRefusalText(reason: RescheduleRefusal, ev: RefusedEvent): string {
  switch (reason) {
    case 'not-a-day': return `${ev.start.trim()} has no day to move; open it to edit.`;
    case 'end-not-a-day': return `${ev.title} ends ${(ev.end ?? '').trim()}, which has no day to move; open it to edit.`;
    case 'out-of-range': return `${ev.title} can’t move that far.`;
    case 'invalid': return `${ev.title} has no date to move.`;
    case 'no-time': return `${ev.start.trim()} has no time to move; open it to edit.`;
    case 'end-before-start': return `${ev.title} can’t end before it starts.`;
  }
}

/** A resize where the view's *Date by* has no end field (#2953): "Call has no end to change in this view." */
export function noEndText(title: string): string {
  return `${title} has no end to change in this view.`;
}
