/**
 * The Timeline layout's view-spec model (#2607, epic #2606): which types may
 * show it, the visible range it pins, and the date property it places notes
 * by. Pure, so the panel, an embed and every export (all `TypeView`) read a
 * spec the same way. Nothing here draws; #2608 does, from `timelineDomain`.
 *
 * - **Any type with a date** (#2715, the Calendar design's Decision 1).
 *   `timeline` is offered for a type with a `date` or `datetime` property,
 *   own or inherited (`canShowTimeline` — the same rule as `canShowCalendar`,
 *   `date-by.ts`'s `hasDateProperty`). It used to be Event and its subtypes
 *   only. A spec that names `timeline` for another type reads back as the
 *   default layout wherever the type is known (`timelineSpecForType`), never
 *   as an error. Where it isn't known yet (the type, or one of its ancestors,
 *   isn't in the catalog), the spec is kept as written and judged when the
 *   view is drawn — the split `groupByForSpec` uses.
 * - **`dateBy`** is `date-by.ts`'s field, the ONE Calendar reads too, so a
 *   view switched between the two keeps its choice. Validated against the
 *   type's date properties here, where the type is known (`dateByForSpec`).
 *   Only Event's `date` / `end` pair draws bars (`endPropertyFor`, Decision
 *   2); any other *Date by* draws points, or precision spans for partial dates.
 * - **`from` / `to`** are date values in the spike's grammar
 *   (`date-precision.ts`): `"1960"`, `"1975-06"`, `"1969-07-20"`, `"-0043"`.
 *   The visible domain is `dateRange(from, to)`: from the start of `from`'s
 *   span to the END of `to`'s, so `from: 1960, to: 1975` shows all of 1975.
 *   Zoom is implied by the range; there is no separate zoom field.
 *   - Both absent means **fit all events**, and nothing is serialised. One
 *     absent leaves that side to the events: `from` alone runs from `from` to
 *     the last event.
 *   - Any precision. A clock value (#2608, with `datetime`, #2613) lets a view
 *     zoomed below a day keep its range; a `to` at clock precision is the
 *     instant itself, as an event's `end` is (`dateRange`), so
 *     `from: 1969-07-20T14:00, to: 1969-07-20T16:00` is two hours.
 *   - Untrusted JSON (a session file, an embed) is read leniently: a number is
 *     taken as written (YAML and JSON both make `1960` a number), and a value
 *     that isn't a date is dropped on its own, without throwing.
 *   - **A `to` that doesn't end after `from` begins** (`from: 1975, to: 1960`)
 *     is not a range at all, so the pair reads back as fit all (both dropped),
 *     per the spike — not swapped, and not half-kept.
 */
import type { ViewLayout } from '../types';
import { settledPropertyDefs, type TypeLike } from './inheritance';
import { dateByForSpec, dateProperties, hasDateProperty } from './date-by';
import { civilMs, dateRange, dateSpan, isClockPrecision, parseDateValue } from './date-precision';

/** A type view's default layout (`openTypeView`, a restored tab without one). */
export const DEFAULT_VIEW_LAYOUT: ViewLayout = 'table';

/** A timeline's visible range; null on a side = fit that side to the events. */
export interface TimelineRange {
  from: string | null;
  to: string | null;
}

/** Fit all events: the default, omitted when serialised. */
export const FIT_ALL: TimelineRange = Object.freeze({ from: null, to: null });

/** May the view of `typeId` show a Timeline? It has a date or datetime
 *  property, own or inherited through `parent` in the catalog `types` — the
 *  same rule as `canShowCalendar` (#2715). False for a type the catalog lacks. */
export function canShowTimeline(typeId: string, types: readonly TypeLike[]): boolean {
  return hasDateProperty(typeId, types);
}

/** One edge from untrusted JSON: a date value at any precision, as written
 *  (trimmed; a whole number as its digits), else null. Never throws. */
export function parseTimelineEdge(raw: unknown): string | null {
  let text: string;
  if (typeof raw === 'number' && Number.isInteger(raw)) text = String(raw);
  else if (typeof raw === 'string') text = raw.trim();
  else return null;
  return parseDateValue(text) ? text : null;
}

/** `from` / `to` from untrusted JSON (see the header): each invalid edge
 *  dropped on its own; a `to` that doesn't end after `from` begins drops both. */
export function parseTimelineRange(from: unknown, to: unknown): TimelineRange {
  const f = parseTimelineEdge(from);
  const t = parseTimelineEdge(to);
  if (f !== null && t !== null) {
    const r = dateRange(f, t);
    if (!r.ok || r.range.endIssue !== null) return FIT_ALL;
  }
  return f === null && t === null ? FIT_ALL : { from: f, to: t };
}

/** Is this the default (fit all)? */
export function isFitAll(range: TimelineRange): boolean {
  return range.from === null && range.to === null;
}

/**
 * The range as civil-axis ms (`date-precision.ts`), [start, end): `start` is
 * the start of `from`'s span, `end` the end of `to`'s — or, for a `to` at
 * clock precision, that instant. Null on a side that fits to the events — and
 * on one that doesn't parse, so a range that skipped `parseTimelineRange`
 * still can't draw an invalid domain.
 */
export function timelineDomain(range: TimelineRange): { start: number | null; end: number | null } {
  const { from, to } = parseTimelineRange(range.from, range.to);
  return { start: from === null ? null : dateSpan(from)!.start, end: to === null ? null : endOf(to) };
}

/** Where a range ending at `to` ends: its span's end, or the instant itself at
 *  clock precision — `dateRange`'s rule for an event's `end`. */
function endOf(to: string): number {
  const span = dateSpan(to)!;
  return isClockPrecision(span.precision) ? span.start : span.end;
}

/** A year as the grammar writes it: `1960`, `0044`, `-0043`, `+12026`. */
function formatYear(y: number): string {
  const digits = String(Math.abs(y)).padStart(4, '0');
  if (y < 0) return `-${digits}`;
  return y > 9999 ? `+${digits}` : digits;
}

function formatDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${formatYear(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function formatMinute(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${formatDay(ms)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function onYearBoundary(ms: number): boolean {
  return civilMs(new Date(ms).getUTCFullYear(), 0, 1) === ms;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Write whole days only while rounding out to them grows the range by at most
 *  this much; past it, a zoomed-in range is written to the minute. */
export const DAY_ROUNDING_TOLERANCE = 1.25;

/**
 * The range to store for a visible domain [start, end) in civil ms — what
 * #2608 writes after a zoom or pan. The coarsest precision that covers it, per
 * the spike: whole years when both edges sit on year boundaries, else the days
 * the domain touches — unless rounding out to whole days would grow it by more
 * than `DAY_ROUNDING_TOLERANCE` (a view zoomed in to hours), when it is the
 * minutes it touches, as floating clock values (`1969-07-20T14:05`) with `to`
 * the instant it ends. Fit all for an empty or non-finite domain.
 */
export function timelineRangeFromDomain(start: number, end: number): TimelineRange {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return FIT_ALL;
  if (onYearBoundary(start) && onYearBoundary(end)) {
    return { from: formatYear(new Date(start).getUTCFullYear()), to: formatYear(new Date(end).getUTCFullYear() - 1) };
  }
  const dayStart = Math.floor(start / DAY_MS) * DAY_MS;
  const dayEnd = Math.ceil(end / DAY_MS) * DAY_MS;
  if (dayEnd - dayStart <= (end - start) * DAY_ROUNDING_TOLERANCE) return { from: formatDay(start), to: formatDay(end - 1) };
  return { from: formatMinute(Math.floor(start / MINUTE_MS) * MINUTE_MS), to: formatMinute(Math.ceil(end / MINUTE_MS) * MINUTE_MS) };
}

/** The timeline fields of a view spec. `dateBy` is shared with Calendar. */
export interface TimelineSpecFields {
  layout: ViewLayout;
  from: string | null;
  to: string | null;
  dateBy: string | null;
}

/**
 * The layout, range and date property a spec carries for `typeId`, judged
 * against the catalog:
 * - a type with no date property: a `timeline` layout reads back as
 *   `DEFAULT_VIEW_LAYOUT`, and the range and `dateBy` are dropped (they mean
 *   nothing without a date);
 * - a type with one: the range is kept under any layout, and a `dateBy` that
 *   isn't one of its date choices is dropped (`dateByForSpec`) — a text
 *   property, a renamed one, or Event's `end`.
 *
 * Where the schema isn't known here, the spec is kept as written: `types`
 * null, a catalog without `typeId`, or a `parent` chain that leaves the
 * catalog before it ends — a subtype whose ancestors haven't loaded yet must
 * not lose its timeline, or an inherited `dateBy`, to a half-loaded catalog.
 */
export function timelineSpecForType(
  spec: TimelineSpecFields,
  typeId: string,
  types: readonly TypeLike[] | null,
): TimelineSpecFields {
  const props = settledPropertyDefs(typeId, types);
  if (props === null) return { layout: spec.layout, from: spec.from, to: spec.to, dateBy: spec.dateBy };
  if (dateProperties(props).length === 0) {
    return { layout: spec.layout === 'timeline' ? DEFAULT_VIEW_LAYOUT : spec.layout, from: null, to: null, dateBy: null };
  }
  return { layout: spec.layout, from: spec.from, to: spec.to, dateBy: dateByForSpec(spec.dateBy, props) };
}
