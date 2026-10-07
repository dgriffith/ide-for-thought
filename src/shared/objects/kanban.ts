/**
 * The Kanban layout's model (#2601, epic #2600): which property a board
 * groups by, and how a view's instances fall into its columns. Pure, so the
 * panel, an embed and every export (all `TypeView`) group the same way.
 *
 * - **`groupBy`** is a view-spec field naming an **enum** property of the type,
 *   own or inherited (`effectivePropertyDefs`). Untrusted JSON (a session, an
 *   embed) can only be checked for shape — `parseGroupBy` keeps any non-empty
 *   string. It's checked against the type wherever the schema is known
 *   (`resolveGroupBy` at render, `groupByForSpec` when serialising), the way a
 *   filter naming a property the type doesn't have is carried by the parser
 *   and simply matches nothing when the view is drawn.
 * - **Default.** No `groupBy`, or one that isn't an enum property of the type
 *   (a hand edit, a property since renamed or retyped), groups by the type's
 *   first enum property. A type with no enum property has no board, and the
 *   layout switcher doesn't offer one (`canShowKanban`).
 * - **Columns** (`groupInstances`): the enum's options in declared order, then
 *   any value that isn't an option (hand-edited frontmatter) in first-seen
 *   order — shown, not hidden — then **No value** last.
 * - **`columnOrder`** (#2614) is a per-view column order: column keys
 *   (`columnKey` — the option value, `""` for No value). Listed columns come
 *   first, in the listed order; the rest follow in their natural order, so a
 *   newly added option lands after the listed ones and **No value** stays last
 *   unless it is listed. It only ever orders columns that exist: a stale entry
 *   naming an option the type no longer has makes no column. Empty means the
 *   natural order, and is omitted when serialised. The order belongs to the
 *   view, never the type — reordering doesn't touch the enum definition.
 * - **`showEmptyColumns`** (#2614), default on: off hides columns with no
 *   cards. On by default because an empty column is still a drop target.
 */
import type { PropertyDef, TypeInstanceRow } from './type-def';
import { effectivePropertyDefs, type TypeLike } from './inheritance';
import { isValuesFilter, type ValuesFilter, type ViewFilter } from './view-spec';

/** The No value column's heading. */
export const NO_VALUE_LABEL = 'No value';

/** No value's key in `columnOrder` and `data-column-value` — the empty value. */
export const NO_VALUE_KEY = '';

/** A column's key: its value, or `NO_VALUE_KEY` for No value. */
export function columnKey(col: { value: string | null }): string {
  return col.value ?? NO_VALUE_KEY;
}

/** `columnOrder` from untrusted JSON: the string entries of an array, first
 *  occurrence kept; anything else is absent (`[]`). Never throws. */
export function parseColumnOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === 'string'))];
}

/** `showEmptyColumns` from untrusted JSON: only an explicit `false` turns it off. */
export function parseShowEmptyColumns(raw: unknown): boolean {
  return raw !== false;
}

/** `groupBy` from untrusted JSON: a non-empty string, else absent. Whether it
 *  names an enum property is the schema's call (`resolveGroupBy`). */
export function parseGroupBy(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/** The properties a board can group by: the enum ones, in declared order. */
export function enumProperties(props: readonly PropertyDef[]): PropertyDef[] {
  return props.filter((p) => p.type === 'enum');
}

/** Does this type (its effective properties) support a Kanban layout? */
export function canShowKanban(props: readonly PropertyDef[]): boolean {
  return props.some((p) => p.type === 'enum');
}

/**
 * The property a board groups by: `groupBy` when it names one of the type's
 * enum properties, else the first enum property, else null (no board).
 * `props` are the type's EFFECTIVE properties, so an inherited enum counts.
 */
export function resolveGroupBy(groupBy: string | null | undefined, props: readonly PropertyDef[]): PropertyDef | null {
  const enums = enumProperties(props);
  return (groupBy ? enums.find((p) => p.name === groupBy) : undefined) ?? enums[0] ?? null;
}

/**
 * The `groupBy` a serialised spec carries: the explicit choice when it is one
 * of the type's enum properties, else null (omitted — the default). `props`
 * null means the schema isn't known here, so the choice is kept as it is and
 * left for `resolveGroupBy` to judge when the view is drawn.
 */
export function groupByForSpec(groupBy: string | null | undefined, props: readonly PropertyDef[] | null): string | null {
  if (!groupBy) return null;
  if (props === null) return groupBy;
  return enumProperties(props).some((p) => p.name === groupBy) ? groupBy : null;
}

/** `groupByForSpec` for a view known only by its type id — Save as note, from
 *  the tab. The type's effective properties come from `types` (the catalog);
 *  a type the catalog doesn't have keeps the choice as it is. */
export function groupByForType(groupBy: string | null | undefined, typeId: string, types: readonly TypeLike[]): string | null {
  const byId = new Map(types.map((t) => [t.id, t] as const));
  return groupByForSpec(groupBy, byId.has(typeId) ? effectivePropertyDefs(typeId, byId) : null);
}

/** How a column came to exist. */
export type KanbanColumnKind = 'option' | 'off-list' | 'no-value';

export interface KanbanColumn {
  /** The property value this column holds; null for **No value**. */
  value: string | null;
  /** The column heading: the value itself, or `NO_VALUE_LABEL`. */
  label: string;
  /** `option` — one of the enum's declared options; `off-list` — a value the
   *  enum doesn't declare (hand-edited frontmatter); `no-value` — empty. */
  kind: KanbanColumnKind;
  /** The column's cards, in the order `instances` arrived (the view's sort). */
  instances: TypeInstanceRow[];
}

/**
 * Options to `groupInstances`. A bag rather than positional arguments so the
 * view-spec fields that shape a board join it without touching callers.
 */
export interface GroupInstancesOptions {
  /** The grouped enum property's declared options (`PropertyDef.options`), in
   *  order — the board's columns before any off-list value. */
  enumOptions: readonly string[];
  /** The view's column order (#2614), as column keys; absent or empty = the
   *  natural order. */
  columnOrder?: readonly string[] | undefined;
  /** Show columns with no cards (#2614); default true. */
  showEmptyColumns?: boolean | undefined;
}

/** The board-shaping view-spec fields `boardColumns` passes through. */
export type BoardOptions = Pick<GroupInstancesOptions, 'columnOrder' | 'showEmptyColumns'>;

/**
 * `columns` in `columnOrder` (#2614): listed columns first, in the listed
 * order, then the unlisted ones in the order they came. A listed key with no
 * column is skipped — it never makes one. Stable, and a no-op for an empty
 * order.
 */
export function orderColumns<C extends { value: string | null }>(columns: readonly C[], columnOrder: readonly string[] | undefined): C[] {
  if (!columnOrder || columnOrder.length === 0) return [...columns];
  const rank = new Map<string, number>();
  columnOrder.forEach((key, i) => { if (!rank.has(key)) rank.set(key, i); });
  const listed = columns.filter((c) => rank.has(columnKey(c))).sort((a, b) => rank.get(columnKey(a))! - rank.get(columnKey(b))!);
  return [...listed, ...columns.filter((c) => !rank.has(columnKey(c)))];
}

/**
 * Group a view's instances into board columns by the `groupBy` property's
 * value: one column per declared option, in declared order, whether or not
 * any card has it (an empty column is still somewhere to put a card); then a
 * column per off-list value, in first-seen order; then **No value**, last,
 * for notes that leave the property empty. Cards keep their input order.
 *
 * Then the view's `columnOrder` reorders them (`orderColumns`), and
 * `showEmptyColumns: false` drops every column with no cards (#2614).
 */
export function groupInstances(
  instances: readonly TypeInstanceRow[],
  groupBy: string,
  options: GroupInstancesOptions,
): KanbanColumn[] {
  const columns = new Map<string, KanbanColumn>();
  for (const value of options.enumOptions) {
    if (!columns.has(value)) columns.set(value, { value, label: value, kind: 'option', instances: [] });
  }
  const noValue: KanbanColumn = { value: null, label: NO_VALUE_LABEL, kind: 'no-value', instances: [] };
  for (const inst of instances) {
    const value = inst.values[groupBy];
    if (value === null || value === undefined || value === '') {
      noValue.instances.push(inst);
      continue;
    }
    let col = columns.get(value);
    if (!col) {
      col = { value, label: value, kind: 'off-list', instances: [] };
      columns.set(value, col); // Map keeps insertion order: off-list values follow the options
    }
    col.instances.push(inst);
  }
  const ordered = orderColumns([...columns.values(), noValue], options.columnOrder);
  return options.showEmptyColumns === false ? ordered.filter((c) => c.instances.length > 0) : ordered;
}

/**
 * The `columnOrder` after moving column `key` to just `side` of column
 * `target` (#2614) — a header drag, or *Move column left / right* (the
 * neighbouring *visible* column, so a column hidden by *Show empty columns*
 * keeps its place). `instances` is every instance of the type, so an
 * off-list column's place survives a filter that hides its cards.
 *
 * Normalised so the spec stays short and keeps its promises: No value is
 * left out while it is last (so it stays last when an option is added), and
 * an order that is just the natural one comes back empty — omitted.
 */
export function moveColumn(
  instances: readonly TypeInstanceRow[],
  group: PropertyDef,
  columnOrder: readonly string[] | undefined,
  key: string,
  target: string,
  side: 'before' | 'after',
): string[] {
  const enumOptions = group.options ?? [];
  const natural = groupInstances(instances, group.name, { enumOptions }).map(columnKey);
  const keys = groupInstances(instances, group.name, { enumOptions, columnOrder }).map(columnKey);
  if (key === target || !keys.includes(key) || !keys.includes(target)) return [...(columnOrder ?? [])];
  const next = keys.filter((k) => k !== key);
  next.splice(next.indexOf(target) + (side === 'after' ? 1 : 0), 0, key);
  if (next.every((k, i) => k === natural[i])) return [];
  return next.at(-1) === NO_VALUE_KEY ? next.slice(0, -1) : next;
}

/**
 * The columns a board actually draws (#2602): `groupInstances`, then two
 * view-level rules on top of it.
 *
 * - **No value** appears only when some card has no value. `groupInstances`
 *   always returns it (an empty one is still a drop target once cards move,
 *   #2603), but an empty No value column on a board where every note is
 *   filed is noise.
 * - **A *values* filter on the grouping property** narrows the columns to the
 *   values it lists. Those are the only cards the view shows, so the other
 *   columns could only ever be empty. A range filter, or a filter on another
 *   property, leaves the columns alone.
 *
 * `filters` is the view's filters; `instances` must already be scoped,
 * filtered and sorted — cards keep this order within a column. `options` are
 * the view's `columnOrder` and `showEmptyColumns` (#2614), applied by
 * `groupInstances`.
 */
export function boardColumns(
  instances: readonly TypeInstanceRow[],
  group: PropertyDef,
  filters: readonly ViewFilter[] = [],
  options: BoardOptions = {},
): KanbanColumn[] {
  const allowed = filters
    .filter((f): f is ValuesFilter => f.property === group.name && isValuesFilter(f))
    .map((f) => new Set(f.values));
  return groupInstances(instances, group.name, { ...options, enumOptions: group.options ?? [] }).filter((col) => {
    if (col.kind === 'no-value') return col.instances.length > 0;
    return allowed.every((values) => values.has(col.value!));
  });
}
