/**
 * The view layouts a typed-object view can show (#2623, epic #2622): ONE
 * registry, which every other mention derives from.
 *
 * A layout used to be named in seven places that had to agree by hand — the
 * `ViewLayout` union, `SavedTypeViewTab.layout`, `TypeViewLayout`, two local
 * `Layout` unions in `TypeView` / `TypeViewLayoutSwitch`, the embed parser's
 * `LAYOUTS` set, and Save as note's `LAYOUT_NAMES` — and the rule for when
 * each is offered lived in the switcher. Now the union is derived from this
 * list, the switcher offers `layoutsFor(...)`, the parser validates with
 * `isViewLayout`, and `tests/architecture/view-layout-registry.test.ts` fails
 * if another file lists layout ids again.
 *
 * Built-ins register here; plugins will contribute through the same list
 * (#2615). Pure and shared: the renderer's component for each layout is the
 * renderer's business.
 */
import type { PropertyDef } from './type-def';
import type { TypeLike } from './inheritance';
import { canShowKanban } from './kanban';
import { hasDateProperty } from './date-by';

/** What a layout may look at to decide whether a type can show it. */
export interface LayoutContext {
  typeId: string;
  /** The type's effective (own + inherited) properties. */
  properties: readonly PropertyDef[];
  /** The type catalog, for rules that walk the inheritance chain. */
  catalog: readonly TypeLike[];
}

export interface ViewLayoutDef {
  id: string;
  /** The switcher's label. */
  label: string;
  /** The word Save as note puts in a suggested name ("Museum table"). */
  noteName: string;
  /** May a view of this type show the layout? Not offered when false. */
  appliesTo: (ctx: LayoutContext) => boolean;
  /** Places notes by a date property, so the view shows the Date by picker. */
  dated: boolean;
  /** The view-spec fields only this layout reads (`dateBy` belongs to every
   *  dated layout). Everything else in a spec is `COMMON_SPEC_FIELDS`. */
  specFields: readonly string[];
}

const always = (): boolean => true;
const datedRule = (ctx: LayoutContext): boolean => hasDateProperty(ctx.typeId, ctx.catalog);

export const VIEW_LAYOUTS = [
  { id: 'list', label: 'List', noteName: 'list', appliesTo: always, dated: false, specFields: [] },
  { id: 'table', label: 'Table', noteName: 'table', appliesTo: always, dated: false, specFields: [] },
  { id: 'gallery', label: 'Gallery', noteName: 'gallery', appliesTo: always, dated: false, specFields: [] },
  // A location-shaped property (#2066) — not offered for Book/Person/etc.
  { id: 'map', label: 'Map', noteName: 'map', appliesTo: (ctx) => ctx.properties.some((p) => p.type === 'geo'), dated: false, specFields: ['mapStyle'] },
  // A board's columns are an enum's options (#2601).
  { id: 'kanban', label: 'Kanban', noteName: 'board', appliesTo: (ctx) => canShowKanban(ctx.properties), dated: false, specFields: ['groupBy', 'columnOrder', 'showEmptyColumns'] },
  // A date or datetime property, own or inherited (#2715).
  { id: 'timeline', label: 'Timeline', noteName: 'timeline', appliesTo: datedRule, dated: true, specFields: ['from', 'to', 'dateBy'] },
  // The same rule as Timeline (#2702).
  { id: 'calendar', label: 'Calendar', noteName: 'calendar', appliesTo: datedRule, dated: true, specFields: ['month', 'dateBy'] },
] as const satisfies readonly ViewLayoutDef[];

/** A layout id — derived from the registry, so adding one is one entry. */
export type ViewLayout = (typeof VIEW_LAYOUTS)[number]['id'];

/** The layout a view starts in, and the one a spec falls back to when its
 *  layout doesn't apply to the type. */
export const DEFAULT_VIEW_LAYOUT: ViewLayout = 'table';

/** Spec fields every layout reads (scope, sort, columns, the embed's frame). */
export const COMMON_SPEC_FIELDS: readonly string[] = [
  'typeId', 'layout', 'sortColumn', 'sortDir', 'columns', 'folder', 'filters', 'height', 'width',
];

const BY_ID: ReadonlyMap<string, ViewLayoutDef> = new Map(VIEW_LAYOUTS.map((l) => [l.id, l]));

export function isViewLayout(value: unknown): value is ViewLayout {
  return typeof value === 'string' && BY_ID.has(value);
}

export function layoutDef(id: ViewLayout): ViewLayoutDef {
  return BY_ID.get(id)!;
}

/** The layouts a view of this type may show, in the switcher's order. */
export function layoutsFor(ctx: LayoutContext): ViewLayout[] {
  return VIEW_LAYOUTS.filter((l) => l.appliesTo(ctx)).map((l) => l.id);
}

/** `"list", "table", …` — for messages that list the valid ids. */
export function layoutIdList(): string {
  return VIEW_LAYOUTS.map((l) => `"${l.id}"`).join(', ');
}
