/**
 * The Calendar layout's view-spec model (#2701, epic #2699): which types may
 * show it, the month it is anchored on, and the date property it places notes
 * by. Pure, so the panel, an embed and every export (all `TypeView`) read a
 * spec the same way. Nothing here draws; the month grid is #2702's, from
 * `calendar-grid.ts`. Decided in the design story (#2700,
 * `docs/vision/objects-expansion.md`, "Calendar").
 *
 * - **Any type with a date.** `calendar` is offered for a type with a `date` or
 *   `datetime` property, own or inherited (`canShowCalendar`, Decision 1) — not
 *   by Event ancestry. A spec that names `calendar` for another type reads
 *   back as the default layout wherever the type is known
 *   (`calendarSpecForType`), never as an error. Where it isn't known yet (the
 *   type, or one of its ancestors, isn't in the catalog), the spec is kept as
 *   written and judged when the view is drawn — `timelineSpecForType`'s split.
 * - **`month`** anchors the page: a month-precision date value, `"2026-10"`,
 *   `"-0043-03"` (March 44 BCE), `"+12026-01"`, read with `parseMonthAnchor`
 *   and written back with `formatMonthAnchor` (`parseCalendarMonth`). Absent
 *   means **the current month**, judged when the view is drawn, and nothing is
 *   serialised. Untrusted JSON is read leniently: anything that isn't a month
 *   (a day, a year, junk) is dropped, without throwing.
 * - **`dateBy`** is `date-by.ts`'s shared field, validated against the type's
 *   date properties by `calendarSpecForType` where the type is known.
 */
import type { ViewLayout } from '../types';
import { effectivePropertyDefs, type TypeLike } from './inheritance';
import { dateByForSpec, dateProperties } from './date-by';
import { formatMonthAnchor, parseMonthAnchor } from './calendar-grid';
import { DEFAULT_VIEW_LAYOUT } from './timeline';

/** May the view of `typeId` show a Calendar? It has a date or datetime
 *  property, own or inherited through `parent` in the catalog `types`. False
 *  for a type the catalog lacks. */
export function canShowCalendar(typeId: string, types: readonly TypeLike[]): boolean {
  const byId = new Map(types.map((t) => [t.id, t] as const));
  return byId.has(typeId) && dateProperties(effectivePropertyDefs(typeId, byId)).length > 0;
}

/** `month` from untrusted JSON: the anchor in its canonical text (`2026-10`)
 *  when it is a month-precision date value, else null (the current month).
 *  Never throws. */
export function parseCalendarMonth(raw: unknown): string | null {
  const m = parseMonthAnchor(typeof raw === 'string' ? raw.trim() : raw);
  return m ? formatMonthAnchor(m) : null;
}

/** The calendar fields of a view spec. */
export interface CalendarSpecFields {
  layout: ViewLayout;
  month: string | null;
  dateBy: string | null;
}

/**
 * The layout, month and date property a spec carries for `typeId`, judged
 * against the catalog:
 * - a type with no date property: a `calendar` layout reads back as
 *   `DEFAULT_VIEW_LAYOUT`, and `month` and `dateBy` are dropped (they mean
 *   nothing without a date);
 * - a type with one: the month is kept under any layout, so switching back to
 *   Calendar keeps the page, and a `dateBy` that isn't one of its date choices
 *   is dropped (`dateByForSpec`).
 *
 * Where the schema isn't known here, the spec is kept as written: `types`
 * null, a catalog without `typeId`, or a `parent` chain that leaves the
 * catalog before it ends — a subtype whose ancestors haven't loaded yet must
 * not lose its calendar, or an inherited `dateBy`, to a half-loaded catalog.
 */
export function calendarSpecForType(
  spec: CalendarSpecFields,
  typeId: string,
  types: readonly TypeLike[] | null,
): CalendarSpecFields {
  const byId = types === null ? null : new Map(types.map((t) => [t.id, t] as const));
  if (byId === null || !chainKnown(typeId, byId)) return { layout: spec.layout, month: spec.month, dateBy: spec.dateBy };
  const props = effectivePropertyDefs(typeId, byId);
  if (dateProperties(props).length === 0) {
    return { layout: spec.layout === 'calendar' ? DEFAULT_VIEW_LAYOUT : spec.layout, month: null, dateBy: null };
  }
  return { layout: spec.layout, month: spec.month, dateBy: dateByForSpec(spec.dateBy, props) };
}

/** Is `typeId`'s whole `parent` chain in the catalog — ending at a root, or a
 *  cycle — so its effective properties are settled? */
function chainKnown(typeId: string, byId: ReadonlyMap<string, TypeLike>): boolean {
  const visited = new Set<string>();
  let cur = byId.get(typeId);
  if (!cur) return false;
  while (!visited.has(cur.id)) {
    visited.add(cur.id);
    if (!cur.parent) return true;
    const next = byId.get(cur.parent);
    if (!next) return false; // the chain leaves the catalog: not known yet
    cur = next;
  }
  return true; // a cycle: effectivePropertyDefs stops there too
}
