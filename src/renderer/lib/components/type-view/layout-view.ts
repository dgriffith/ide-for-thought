/**
 * What a layout component is given (#2623): one `view` object, the same for
 * every layout, so `TypeView` can draw whichever the registry names without
 * knowing which it is.
 *
 * `TypeView` builds it once as an object of getters over its own state, so
 * its identity never changes and a layout reading `view.instances` re-renders
 * only when the instances do. A `$derived` object would be a new value on
 * every change, and a component reading a prop through it would see a
 * "change" every time anything did — #2742's calendar day list closed for
 * exactly that reason.
 */
import type { MapExportHooks } from '../../map/map-export';
import type { MapStyle } from '../../../../shared/objects/map-style';
import type { ViewFilter } from '../../../../shared/objects/view-spec';
import type { KanbanColumn } from '../../../../shared/objects/kanban';
import type { MoveTarget } from '../../../../shared/objects/kanban-move';
import type { DropSide } from '../kanban/column-drag';
import type { ViewLayout } from '../../../../shared/objects/view-layouts';
import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../../shared/objects/type-def';

/** What an export gives a plugin-drawn layout (#2828). */
export interface PluginExportHooks {
  /** The plugin's sanitized export is in the DOM: snapshot it now. */
  onRendered: () => void;
  /** It couldn't be drawn; the export says so in its place. */
  onFailed: (reason: string) => void;
}

/** A change to the view's spec — what the tab (or nothing, in an embed) keeps. */
export interface ViewStatePatch {
  layout?: ViewLayout;
  sortColumn?: string | null;
  sortDir?: 'asc' | 'desc';
  columns?: string[] | null;
  folder?: string | null;
  filters?: ViewFilter[];
  mapStyle?: MapStyle;
  groupBy?: string | null;
  columnOrder?: string[];
  showEmptyColumns?: boolean;
  from?: string | null;
  to?: string | null;
  month?: string | null;
  dateBy?: string | null;
}

export interface LayoutView {
  type: TypeInfo;
  /** The type's effective (own + inherited) properties. */
  properties: PropertyDef[];
  /** The columns a table shows: `properties` narrowed to the view's `columns`. */
  visibleColumns: PropertyDef[];
  /** The view's visible property names (null = all) — a board's card template. */
  visible: string[] | null;
  /** The notes this view shows: in scope, filtered. */
  instances: TypeInstanceRow[];
  /** `instances` in the view's sort order. */
  sorted: TypeInstanceRow[];
  sortColumn: string | null;
  sortDir: 'asc' | 'desc';
  toggleSort: (column: string) => void;
  /** The view's filters, with the Type filter resolved. */
  filters: ViewFilter[];

  display: (prop: PropertyDef, value: string | null) => string;
  /** A row's own type (a subtype's icon in a parent's view). */
  rowType: (inst: TypeInstanceRow) => TypeInfo | null;
  /** The first non-empty property, as "Label: value". */
  summary: (inst: TypeInstanceRow) => string;

  /** Rows multi-select (#2431) — false in an embed or export. */
  selectable: boolean;
  /** A row or card has a menu — the panel, or an embed with note actions —
   *  so it takes focus and the menu key (#2776). */
  rowMenu: boolean;
  isSelected: (path: string) => boolean;
  onRowClick: (e: MouseEvent, path: string) => void;
  onRowContextMenu: (e: MouseEvent, path: string) => void;
  /** The note a `link-to-type` value names, when it's one that exists (#2775). */
  refPath: (prop: PropertyDef, value: string | null) => string | null;
  /** Right-click that named note: the menu for it, not for the row. */
  onRefContextMenu: (e: MouseEvent, path: string, label: string) => void;
  /** The row menu for these notes at a point in the window — a plugin layout's
   *  `ui.showNoteMenu` (#2828). */
  openRowMenu: (paths: readonly string[], clientX: number, clientY: number) => void;

  onOpenNote: (path: string) => void;
  onStateChange: (patch: ViewStatePatch) => void;
  /** An embed or export: no controls that would write the spec. */
  readOnly: boolean;
  /** Drawing for an export snapshot. */
  exportMode: boolean;
  /** A plugin layout tells the export it has drawn (#2828), as a map hands back its capture. */
  pluginExport: PluginExportHooks | undefined;

  // ── What a particular layout reads ──
  /** Map: the type's location property, null when it has none. */
  locationProperty: string | null;
  mapStyle: MapStyle;
  mapExport: MapExportHooks | undefined;
  /** Kanban: the grouping enum, and its columns of cards. */
  group: PropertyDef | null;
  board: KanbanColumn[];
  onMoveCard: ((path: string, target: MoveTarget) => void) | undefined;
  onUndoMove: (() => void) | undefined;
  onMoveColumn: ((key: string, target: string, side: DropSide) => void) | undefined;
  /** Timeline and Calendar: their spec, already judged against the type. */
  from: string | null;
  to: string | null;
  month: string | null;
  dateBy: string | null;
}
