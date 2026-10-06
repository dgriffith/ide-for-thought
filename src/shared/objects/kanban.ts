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
 */
import type { PropertyDef, TypeInstanceRow } from './type-def';
import { effectivePropertyDefs, type TypeLike } from './inheritance';
import { isValuesFilter, type ValuesFilter, type ViewFilter } from './view-spec';

/** The No value column's heading. */
export const NO_VALUE_LABEL = 'No value';

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
 * view-spec fields that shape a board can join it without touching callers:
 * #2614 adds `columnOrder` (a per-view column order) and `showEmptyColumns`.
 */
export interface GroupInstancesOptions {
  /** The grouped enum property's declared options (`PropertyDef.options`), in
   *  order — the board's columns before any off-list value. */
  enumOptions: readonly string[];
}

/**
 * Group a view's instances into board columns by the `groupBy` property's
 * value: one column per declared option, in declared order, whether or not
 * any card has it (an empty column is still somewhere to put a card); then a
 * column per off-list value, in first-seen order; then **No value**, always
 * last, for notes that leave the property empty. Cards keep their input order.
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
  return [...columns.values(), noValue];
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
 * filtered and sorted — cards keep this order within a column.
 */
export function boardColumns(
  instances: readonly TypeInstanceRow[],
  group: PropertyDef,
  filters: readonly ViewFilter[] = [],
): KanbanColumn[] {
  const allowed = filters
    .filter((f): f is ValuesFilter => f.property === group.name && isValuesFilter(f))
    .map((f) => new Set(f.values));
  return groupInstances(instances, group.name, { enumOptions: group.options ?? [] }).filter((col) => {
    if (col.kind === 'no-value') return col.instances.length > 0;
    return allowed.every((values) => values.has(col.value!));
  });
}
