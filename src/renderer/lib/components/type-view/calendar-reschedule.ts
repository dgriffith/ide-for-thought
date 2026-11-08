/**
 * A calendar's reschedule, Minerva's half (#2829): the Calendar plugin asks
 * with `view.reschedule` (a note, whole days), and the type view runs the
 * `kanban-moves` store's `rescheduleEvent` — start and end in one save, with
 * its undo and its announcement — naming the days the way the calendar did,
 * and Local History the plugin that asked.
 *
 * By time (#2953): the Week and Day grids ask with `view.retime` (start and
 * end by whole minutes) or `view.resize` (the end alone), and
 * `retimeInView` runs the store's `retimeEvent` the same way, naming the
 * landing time ("Wednesday, 7 October 2026, 10:00", or "at 11:30" for an
 * end on the start's day).
 *
 * The row menu's *Move to date…* (#2929) asks the plugin to let the user
 * choose the day; `moveToDateRefusal` is why it's disabled, the same sentence
 * the calendar speaks on a refused drag.
 */
import { addDays, dayStart } from '../../../../shared/objects/calendar-grid';
import { startDayOf } from '../../../../shared/objects/date-shift';
import { dateSpan } from '../../../../shared/objects/date-precision';
import { dayName } from '../../../../shared/calendar/calendar-model';
import { timelineProperties } from '../../../../shared/timeline/timeline-events';
import type { PropertyDef, TypeInstanceRow } from '../../../../shared/objects/type-def';
import type { getKanbanMoveStore } from '../../stores/kanban-moves.svelte';
import { refusalFor } from '../../../../shared/calendar/reschedule-refusal';

/** Move `inst` by `days` whole days on the view's *Date by* (and, for Event, its `end`). */
export function rescheduleInView(
  moves: ReturnType<typeof getKanbanMoveStore>,
  inst: TypeInstanceRow,
  view: { properties: readonly PropertyDef[]; dateBy: string | null; cause?: string | undefined; locale?: string | undefined },
  days: number,
): void {
  if (!Number.isInteger(days) || days === 0) return;
  const dates = timelineProperties(view.dateBy, view.properties);
  const from = startDayOf((inst.values[dates.dateProperty] ?? '').trim());
  if (from === null) return; // nothing to count from; the store would refuse it anyway
  void moves.rescheduleEvent(
    { path: inst.path, title: inst.title },
    { start: dates.dateProperty, end: dates.endProperty },
    days,
    { to: dayName(addDays(from, days), view.locale), back: dayName(from, view.locale) },
    view.cause ? { cause: view.cause } : {},
  );
}

/** Why `inst` can't be moved to another day on the view's *Date by*, or null when it can (#2929). */
export function moveToDateRefusal(
  inst: TypeInstanceRow,
  view: { properties: readonly PropertyDef[]; dateBy: string | null },
): string | null {
  return refusalFor({ inst, title: inst.title }, timelineProperties(view.dateBy, view.properties));
}

/** Where a written value shows for the viewer: its day, "Wednesday, 7 October 2026, 10:00", and the time alone. */
function whenOf(raw: string | null, locale?: string): { day: number; text: string; time: string } | null {
  const span = raw === null ? null : dateSpan(raw);
  if (!span) return null;
  const day = dayStart(span.start);
  const time = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(span.start));
  return { day, time, text: span.precision === 'day' ? dayName(day, locale) : `${dayName(day, locale)}, ${time}` };
}

/** Move `inst` by `minutes` on the viewer's clock, or (`resize`) its end alone, on the view's *Date by* (#2953). */
export function retimeInView(
  moves: ReturnType<typeof getKanbanMoveStore>,
  inst: TypeInstanceRow,
  view: { properties: readonly PropertyDef[]; dateBy: string | null; cause?: string | undefined; locale?: string | undefined },
  minutes: number,
  kind: 'move' | 'resize',
): void {
  if (!Number.isInteger(minutes) || minutes === 0) return;
  const dates = timelineProperties(view.dateBy, view.properties);
  const start = (inst.values[dates.dateProperty] ?? '').trim();
  const end = dates.endProperty === null ? null : (inst.values[dates.endProperty] ?? '').trim() || null;
  const at = (raw: string | null) => whenOf(raw, view.locale);
  const startAt = at(start);
  const to = (w: { start: string; end: string | null }): string => {
    if (kind === 'move') return at(w.start)?.text ?? w.start;
    const e = at(w.end);
    if (!e) return w.end ?? '';
    return e.day === at(w.start)?.day ? `at ${e.time}` : `on ${e.text}`;
  };
  const back = kind === 'move' ? startAt?.text ?? start : end === null ? 'no end' : at(end)?.text ?? end;
  void moves.retimeEvent(
    { path: inst.path, title: inst.title },
    { start: dates.dateProperty, end: dates.endProperty },
    minutes,
    kind,
    { to, back },
    view.cause ? { cause: view.cause } : {},
  );
}
