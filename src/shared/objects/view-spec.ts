/**
 * A view's scope and filters (#2531, epic #2530): which of a type's instances
 * a view shows. One pure function, `applyViewSpec`, applied by `TypeView` —
 * which the view panel, a note's ```object-view embed and every export render
 * through — so the three can't disagree about what a view contains.
 *
 * - `folder`: only notes under this thoughtbase-relative folder, recursively
 *   (absent → the whole thoughtbase). Matched on path segments, so `trip`
 *   doesn't take in `tripod/`.
 * - `filters`: AND across filters. A *values* filter keeps a note whose value
 *   is one of the listed values (text / enum / link properties); a *range*
 *   filter keeps a value within [min, max] — a number numerically, a `date` or
 *   `datetime` by span (#2613): the value's span starts within
 *   [span(min).start, span(max).end), so a bound covers its whole precision
 *   (`max: 2026-05` keeps all of May) and signed years and mixed offsets order
 *   by time, not by string. A note that leaves the property empty never passes
 *   a filter on it.
 *
 * Values are the instances' lexical strings — the same ones the graph
 * returns — so a saved filter means the same thing on every machine.
 *
 * The reserved key `type` (#2716) is a values filter over the view type's
 * SUBTYPES, matched hierarchically: `{ property: 'type', values: ['restaurant'] }`
 * keeps a note whose own type is Restaurant or any subtype of it (Pizzeria),
 * via `inheritsFrom`. It never falls through to the plain string match —
 * frontmatter `type:` is what assigns a type, so no declared property can mean
 * anything else by it. Matching it needs the catalog and each note's own type
 * (`TypeLookup`); without them a type filter keeps nothing, so a view that
 * can't yet tell a Restaurant from a Museum never shows the unfiltered set as
 * if it were filtered. `resolveTypeFilter` drops stale ids once the catalog is
 * known.
 */
import type { PropertyType, TypeInstanceRow } from './type-def';
import type { SpanOptions } from './date-precision';
import { dateValueInRange, isDateType } from './date-values';
import { inheritsFrom, type TypeLike } from './inheritance';

export interface ValuesFilter { property: string; values: string[] }
export interface RangeFilter { property: string; min?: string | null; max?: string | null }
export type ViewFilter = ValuesFilter | RangeFilter;

export interface ViewScope {
  folder?: string | null | undefined;
  filters?: readonly ViewFilter[] | undefined;
}

export const isValuesFilter = (f: ViewFilter): f is ValuesFilter => Array.isArray((f as ValuesFilter).values);

/** The reserved filter key for a subtype filter (#2716). */
export const TYPE_FILTER_KEY = 'type';
export const isTypeFilter = (f: ViewFilter): boolean => f.property === TYPE_FILTER_KEY;

/** What a type filter needs: the catalog, and each note's own (exact) type. */
export interface TypeLookup {
  byId: ReadonlyMap<string, Pick<TypeLike, 'id' | 'parent'>>;
  typeOf: (path: string) => string | null | undefined;
}

/** Is `id` a strict subtype of `viewTypeId` in `byId`? What a type filter may choose. */
export function isSubtypeOf(id: string, viewTypeId: string, byId: TypeLookup['byId']): boolean {
  return id !== viewTypeId && byId.has(id) && inheritsFrom(id, viewTypeId, byId);
}

/**
 * `filters` with the type filter's stale ids dropped (#2716) — a renamed or
 * deleted type, or one no longer a subtype of the view's type — and the whole
 * filter dropped when none is left. A null catalog (not known yet) changes
 * nothing. Never throws.
 */
export function resolveTypeFilter(
  filters: readonly ViewFilter[],
  viewTypeId: string,
  byId: TypeLookup['byId'] | null,
): ViewFilter[] {
  if (!byId) return [...filters];
  const out: ViewFilter[] = [];
  for (const f of filters) {
    if (!isTypeFilter(f)) { out.push(f); continue; }
    if (!isValuesFilter(f)) continue;
    const values = f.values.filter((v) => isSubtypeOf(v, viewTypeId, byId));
    if (values.length > 0) out.push({ property: f.property, values });
  }
  return out;
}

/** `/trip/prague/` → `trip/prague`; empty or root → null (the whole thoughtbase). */
export function normalizeFolder(folder: string | null | undefined): string | null {
  const f = (folder ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
  return f === '' || f === '.' ? null : f;
}

/** Is `path` inside `folder` (recursively)? A null folder contains everything. */
export function inFolder(path: string, folder: string | null | undefined): boolean {
  const f = normalizeFolder(folder);
  return f === null || path.startsWith(`${f}/`);
}

function inRange(value: string, f: RangeFilter, type: PropertyType | undefined, opts: SpanOptions): boolean {
  const min = f.min ?? null;
  const max = f.max ?? null;
  if (type === 'number') {
    const v = Number(value);
    if (!Number.isFinite(v)) return false;
    if (min !== null && min !== '' && v < Number(min)) return false;
    if (max !== null && max !== '' && v > Number(max)) return false;
    return true;
  }
  // Dates compare as spans (see the header). For four-digit calendar values
  // that is exactly the lexical rule below (pinned in date-precision.test.ts).
  if (isDateType(type)) {
    const bySpan = dateValueInRange(value, min, max, opts);
    if (bySpan !== null) return bySpan;
  }
  // Anything else ranged, or a date value / bound that isn't a date (no span
  // to compare): ISO strings order lexically. A bound like `2026-05` includes
  // every day of May at the top end, so compare the max against the value
  // truncated to the bound's precision.
  if (min !== null && min !== '' && value < min) return false;
  if (max !== null && max !== '' && value.slice(0, max.length) > max) return false;
  return true;
}

/** `opts` fixes the viewer's zone for a value with an offset (tests); the
 *  runtime's zone by default. `types` is what the reserved `type` key needs. */
export function matchesFilter(
  inst: TypeInstanceRow,
  f: ViewFilter,
  type: PropertyType | undefined,
  opts: SpanOptions = {},
  types: TypeLookup | null = null,
): boolean {
  if (isTypeFilter(f)) {
    if (!types || !isValuesFilter(f)) return false;
    const own = types.typeOf(inst.path);
    return !!own && f.values.some((v) => inheritsFrom(own, v, types.byId));
  }
  const value = inst.values[f.property];
  if (value === null || value === undefined || value === '') return false;
  return isValuesFilter(f) ? f.values.includes(value) : inRange(value, f, type, opts);
}

/** The instances a view with this scope shows, in their original order. */
export function applyViewSpec(
  instances: readonly TypeInstanceRow[],
  scope: ViewScope,
  propertyTypes: Readonly<Record<string, PropertyType>> = {},
  types: TypeLookup | null = null,
): TypeInstanceRow[] {
  const filters = scope.filters ?? [];
  return instances.filter((inst) =>
    inFolder(inst.path, scope.folder) && filters.every((f) => matchesFilter(inst, f, propertyTypes[f.property], {}, types)));
}

/**
 * Filters from untrusted JSON (a session file, an embed's spec) — anything
 * malformed is dropped rather than throwing, as the rest of a view spec is.
 */
export function parseViewFilters(raw: unknown): ViewFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewFilter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.property !== 'string' || !o.property) continue;
    if (Array.isArray(o.values)) {
      const values = o.values.filter((v): v is string => typeof v === 'string');
      if (values.length > 0) out.push({ property: o.property, values });
    } else {
      const min = typeof o.min === 'string' && o.min !== '' ? o.min : null;
      const max = typeof o.max === 'string' && o.max !== '' ? o.max : null;
      // The reserved `type` key is a values filter only (#2716).
      if ((min !== null || max !== null) && o.property !== TYPE_FILTER_KEY) out.push({ property: o.property, min, max });
    }
  }
  return out;
}
