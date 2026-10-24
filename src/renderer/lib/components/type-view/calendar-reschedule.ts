/**
 * A calendar's reschedule, Minerva's half (#2829): the Calendar plugin asks
 * with `view.reschedule` (a note, whole days), and the type view runs the
 * `kanban-moves` store's `rescheduleEvent` — start and end in one save, with
 * its undo and its announcement — naming the days the way the calendar did,
 * and Local History the plugin that asked.
 */
import { addDays } from '../../../../shared/objects/calendar-grid';
import { startDayOf } from '../../../../shared/objects/date-shift';
import { dayName } from '../../../../shared/calendar/calendar-model';
import { timelineProperties } from '../../../../shared/timeline/timeline-events';
import type { PropertyDef, TypeInstanceRow } from '../../../../shared/objects/type-def';
import type { getKanbanMoveStore } from '../../stores/kanban-moves.svelte';

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
