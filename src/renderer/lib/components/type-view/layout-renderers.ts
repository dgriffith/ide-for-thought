/**
 * How each view layout is DRAWN (#2623) — the renderer's half of the layout
 * registry in `shared/objects/view-layouts.ts`, which says what each layout
 * is. `TypeView` draws `LAYOUT_RENDERERS[layout].component` with its one
 * `view`; it no longer branches on layout ids.
 *
 * A `Record` keyed by `ViewLayout`, so a layout registered in the shared list
 * without a renderer here does not compile.
 */
import type { Component } from 'svelte';
import type { ViewLayout } from '../../../../shared/objects/view-layouts';
import type { TypeInstanceRow } from '../../../../shared/objects/type-def';
import type { LayoutView } from './layout-view';
import TypeViewList from './TypeViewList.svelte';
import TypeViewTable from './TypeViewTable.svelte';
import TypeViewGallery from './TypeViewGallery.svelte';
import MapLayout from './MapLayout.svelte';
import KanbanLayout from './KanbanLayout.svelte';
import TimelineLayout from './TimelineLayout.svelte';
import CalendarLayout from './CalendarLayout.svelte';

export interface LayoutRenderer {
  component: Component<{ view: LayoutView }>;
  /** The notes in the order the layout draws them — what Export CSV writes
   *  and ⇧-click selects across. Default: the view's notes as filtered. */
  order?: (view: LayoutView) => TypeInstanceRow[];
  /** The toolbar's Columns picker applies (the table's columns). */
  columnPicker?: boolean;
  /** The row menu offers "Move to" a column (a board's). */
  rowMenuMove?: boolean;
  /** An export draws it in a frame of the spec's height, not `auto` (a map
   *  needs a real height to draw into). */
  fixedExportHeight?: boolean;
}

export const LAYOUT_RENDERERS: Record<ViewLayout, LayoutRenderer> = {
  list: { component: TypeViewList },
  table: { component: TypeViewTable, order: (v) => v.sorted, columnPicker: true },
  gallery: { component: TypeViewGallery },
  map: { component: MapLayout, fixedExportHeight: true },
  kanban: { component: KanbanLayout, order: (v) => v.board.flatMap((c) => c.instances), rowMenuMove: true },
  timeline: { component: TimelineLayout },
  calendar: { component: CalendarLayout },
};

/** The notes in the order `layout` draws them. */
export function layoutOrder(layout: ViewLayout, view: LayoutView): TypeInstanceRow[] {
  return LAYOUT_RENDERERS[layout].order?.(view) ?? view.instances;
}
