/**
 * **Date by**: which date property places a type's notes in time (#2701,
 * decided in the Calendar design story #2700, `docs/vision/objects-expansion.md`
 * "Decision 1"). A view-spec field the Calendar layout reads now and Timeline
 * adopts next (#2715), so a view switched between the two keeps its property.
 * Pure, and the same shape as Kanban's `groupBy` (`kanban.ts`):
 *
 * - **Choices** (`dateByChoices`) are the type's `date` and `datetime`
 *   properties, own or inherited (`effectivePropertyDefs`), in declaration
 *   order — except `end` when the type also has `date`, because by the Event
 *   convention `end` is the END of the `date` range, not a start of its own.
 * - **Default** (`defaultDateBy`): the property named `date` when it is a
 *   choice, else the first choice. A type with no choice has no date to place
 *   its notes by, so no Calendar and no Timeline (`hasDateProperty`, behind
 *   both `canShowCalendar` and `canShowTimeline`).
 * - **The picker** appears only when there is a choice to make
 *   (`dateByChoices(…).length > 1`), as Group by does.
 * - **Validation** follows `groupBy`'s split. Untrusted JSON (a session file,
 *   an embed) is checked for shape only (`parseDateBy`): the parser doesn't
 *   know the type. Wherever the schema IS known, `resolveDateBy` picks the
 *   property to draw by and `dateByForSpec` decides what a serialised spec
 *   carries: an explicit choice that names a date property is kept (even one
 *   that happens to equal today's default — the default moves when the type
 *   gains a `date` property, an explicit choice doesn't); anything else is
 *   dropped, and null is omitted when written.
 * - **The end** is read only from Event's convention (Decision 2): a property
 *   named `end` when the view is dated by `date` (`endPropertyFor`).
 */
import type { PropertyDef } from './type-def';
import { effectivePropertyDefs, type TypeLike } from './inheritance';

/** The Event convention's start and end property names (Decision 2). */
export const DATE_PROPERTY = 'date';
export const END_PROPERTY = 'end';

/** Is this a property a view can be dated by — a `date` or a `datetime`? */
export function isDateProperty(p: Pick<PropertyDef, 'type'>): boolean {
  return p.type === 'date' || p.type === 'datetime';
}

/** The type's date and datetime properties, in declaration order. `props` are
 *  its EFFECTIVE properties, so an inherited one counts. */
export function dateProperties(props: readonly PropertyDef[]): PropertyDef[] {
  return props.filter(isDateProperty);
}

/** Can `typeId`'s notes be placed in time — does it have a date or datetime
 *  property, own or inherited through `parent` in the catalog `types`? False
 *  for a type the catalog lacks. The one rule behind `canShowCalendar` and
 *  `canShowTimeline` (Decision 1). */
export function hasDateProperty(typeId: string, types: readonly TypeLike[]): boolean {
  const byId = new Map(types.map((t) => [t.id, t] as const));
  return byId.has(typeId) && dateProperties(effectivePropertyDefs(typeId, byId)).length > 0;
}

/** The properties *Date by* offers: every date property, less `end` when the
 *  type also has a `date` (it ends that range; it doesn't start one). */
export function dateByChoices(props: readonly PropertyDef[]): PropertyDef[] {
  const dates = dateProperties(props);
  const hasDate = dates.some((p) => p.name === DATE_PROPERTY);
  return hasDate ? dates.filter((p) => p.name !== END_PROPERTY) : dates;
}

/** The default: `date` if the type has it, else its first date property, else
 *  null (nothing to date by). */
export function defaultDateBy(props: readonly PropertyDef[]): PropertyDef | null {
  const choices = dateByChoices(props);
  return choices.find((p) => p.name === DATE_PROPERTY) ?? choices[0] ?? null;
}

/** `dateBy` from untrusted JSON: a non-empty string, else absent. Whether it
 *  names a date property is the schema's call (`resolveDateBy`). Never throws. */
export function parseDateBy(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/** The property a view is dated by: `dateBy` when it is one of the choices,
 *  else the default, else null. */
export function resolveDateBy(dateBy: string | null | undefined, props: readonly PropertyDef[]): PropertyDef | null {
  const chosen = dateBy ? dateByChoices(props).find((p) => p.name === dateBy) : undefined;
  return chosen ?? defaultDateBy(props);
}

/**
 * The `dateBy` a serialised spec carries: the explicit choice when it is one
 * of the type's choices, else null (omitted — the default). `props` null means
 * the schema isn't known here, so the choice is kept as written, for
 * `resolveDateBy` to judge when the view is drawn.
 */
export function dateByForSpec(dateBy: string | null | undefined, props: readonly PropertyDef[] | null): string | null {
  if (!dateBy) return null;
  if (props === null) return dateBy;
  return dateByChoices(props).some((p) => p.name === dateBy) ? dateBy : null;
}

/** The property that ends a dated note's range: Event's `end`, only when the
 *  view is dated by `date` and the type has an `end` date property; else null
 *  (every other *Date by* places single-day or single-instant notes). */
export function endPropertyFor(dateBy: PropertyDef | null, props: readonly PropertyDef[]): PropertyDef | null {
  if (dateBy?.name !== DATE_PROPERTY) return null;
  return dateProperties(props).find((p) => p.name === END_PROPERTY) ?? null;
}
