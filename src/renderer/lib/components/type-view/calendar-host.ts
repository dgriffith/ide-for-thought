/**
 * The Calendar plugin's requests, as the type view runs them (#2829, #2953,
 * #2954): a reschedule by days and a move or resize by minutes go to
 * `calendar-reschedule.ts` (the move store, with undo), and a new event
 * (`view.createEvent`) to `lib/app/calendar-create.ts`. `calendarHost` binds
 * all three to what the view shows when the request arrives.
 *
 * Its own module so `calendar-reschedule.ts` stays importable without the
 * dialog and notebase stores the creation path needs.
 */
import { rescheduleInView, rescheduleManyInView, retimeInView } from './calendar-reschedule';
import { createCalendarEvent } from '../../app/calendar-create';
import { timelineProperties } from '../../../../shared/timeline/timeline-events';
import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../../shared/objects/type-def';
import type { getKanbanMoveStore } from '../../stores/kanban-moves.svelte';

/** What the type view is showing, read when a request arrives. */
export interface CalendarHostView {
  instances: readonly TypeInstanceRow[];
  properties: readonly PropertyDef[];
  dateBy: string | null;
  type: TypeInfo | null;
  catalog: readonly TypeInfo[];
  /** Local History's causes: "Moved by Calendar", "Created by Calendar". */
  moveCause: string | undefined;
  createCause: string | undefined;
}

/** The calendar plugin's requests, run against what the view shows now. */
export function calendarHost(moves: ReturnType<typeof getKanbanMoveStore>, view: () => CalendarHostView) {
  const find = (path: string) => view().instances.find((i) => i.path === path);
  return {
    reschedule: (path: string, days: number, paths?: string[]): void => {
      const v = view();
      const inst = find(path);
      if (!inst) return;
      const opts = { properties: v.properties, dateBy: v.dateBy, cause: v.moveCause };
      // A group (#2938): the notes the view still shows, moved together with one undo.
      const group = (paths ?? []).map(find).filter((i): i is TypeInstanceRow => i !== undefined);
      if (group.length > 1) rescheduleManyInView(moves, group, inst, opts, days);
      else rescheduleInView(moves, inst, opts, days);
    },
    retime: (path: string, minutes: number, kind: 'move' | 'resize'): void => {
      const v = view();
      const inst = find(path);
      if (inst) retimeInView(moves, inst, { properties: v.properties, dateBy: v.dateBy, cause: v.moveCause }, minutes, kind);
    },
    createEvent: (start: string, end: string | null): void => {
      const v = view();
      if (!v.type) return;
      void createCalendarEvent({
        type: v.type, catalog: v.catalog, properties: v.properties,
        dates: timelineProperties(v.dateBy, v.properties), start, end, cause: v.createCause,
      });
    },
  };
}
