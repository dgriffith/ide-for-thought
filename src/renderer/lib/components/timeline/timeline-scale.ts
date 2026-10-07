/**
 * The Timeline's axis (#2608): the visible domain, zoom and pan, Fit, and the
 * ticks. Pure, so the maths tests without a DOM.
 *
 * **The scale is one line of arithmetic** — x = (t − d0) · width / (d1 − d0) —
 * over civil-axis ms (`date-precision.ts`). Not d3-scale's `scaleUtc`, which
 * allocates a `Date` per call and formats with `%Y` (the spike, Decisions 1
 * and 4). Ticks come from `d3-time`'s `utcTicks`, which is correct across the
 * whole drawable range; labels from `timeline-format.ts` (`Intl`).
 *
 * **The domain is clamped** to the drawable range, years −99,999 to 99,999
 * (the spike, Decision 4), and to between `MIN_DOMAIN_MS` and that whole
 * range wide. Zoom keeps the instant under the anchor (the pointer, or the
 * focused event) where it is on screen; pan moves the window, never resizes
 * it.
 */
import { utcTicks } from 'd3-time';
import { civilMs } from '../../../../shared/objects/date-precision';
import { civilYear, formatTick, type TickUnit } from './timeline-format';

/** Where the timeline can draw: the start of year −99,999 to the end of 99,999. */
export const DRAWABLE_START = civilMs(-99_999, 0, 1);
export const DRAWABLE_END = civilMs(100_000, 0, 1);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The narrowest view: ten minutes across (a `datetime` meeting, #2613). */
export const MIN_DOMAIN_MS = 10 * MINUTE;
/** Fit leaves this fraction of the events' extent clear at each side. */
export const FIT_PADDING = 0.04;
/** A zoom step (+/−, the buttons); a wheel notch scales by its delta. */
export const ZOOM_STEP = 1.5;
/** Shift+←/→ moves the view by this fraction of its width. */
export const PAN_STEP = 0.2;

export interface Domain {
  start: number;
  end: number;
}

/** Clamp a domain into the drawable range at a legal width, keeping its centre where it can. */
export function clampDomain(d: Domain): Domain {
  let width = Math.min(Math.max(d.end - d.start, MIN_DOMAIN_MS), DRAWABLE_END - DRAWABLE_START);
  if (!Number.isFinite(width)) width = DRAWABLE_END - DRAWABLE_START;
  const mid = (d.start + d.end) / 2;
  let start = Number.isFinite(mid) ? mid - width / 2 : DRAWABLE_START;
  if (start < DRAWABLE_START) start = DRAWABLE_START;
  if (start + width > DRAWABLE_END) start = DRAWABLE_END - width;
  return { start, end: start + width };
}

/**
 * Zoom by `factor` (> 1 zooms in) keeping the instant at `anchor` — a fraction
 * 0..1 across the view — in place. Clamped: past the narrowest view a zoom in
 * is a no-op, not a jump.
 */
export function zoomDomain(d: Domain, factor: number, anchor = 0.5): Domain {
  const width = d.end - d.start;
  const next = Math.min(Math.max(width / factor, MIN_DOMAIN_MS), DRAWABLE_END - DRAWABLE_START);
  const a = Math.min(Math.max(anchor, 0), 1);
  const pivot = d.start + width * a;
  let start = pivot - next * a;
  if (start < DRAWABLE_START) start = DRAWABLE_START;
  if (start + next > DRAWABLE_END) start = DRAWABLE_END - next;
  return { start, end: start + next };
}

/** Move the view by `deltaMs` (positive = later), stopping at the drawable edges. */
export function panDomain(d: Domain, deltaMs: number): Domain {
  const width = d.end - d.start;
  let start = d.start + deltaMs;
  if (start < DRAWABLE_START) start = DRAWABLE_START;
  if (start + width > DRAWABLE_END) start = DRAWABLE_END - width;
  return { start, end: start + width };
}

/** Pan the least needed to show [start, end) (or as much of it as fits), with `margin` (a fraction) clear. */
export function panToShow(d: Domain, start: number, end: number, margin = 0.05): Domain {
  const width = d.end - d.start;
  const pad = width * margin;
  if (end - start > width - 2 * pad) return panDomain(d, start - pad - d.start); // too long: show its start
  if (start < d.start + pad) return panDomain(d, start - pad - d.start);
  if (end > d.end - pad) return panDomain(d, end + pad - d.end);
  return d;
}

/** The px of a civil ms in a view `width` px wide. */
export function xOf(t: number, d: Domain, width: number): number {
  return ((t - d.start) * width) / (d.end - d.start);
}

/** The civil ms at px `x`. */
export function timeAt(x: number, d: Domain, width: number): number {
  return d.start + (x * (d.end - d.start)) / width;
}

/**
 * Fit: the events' extent with `FIT_PADDING` each side, then bounded by a date
 * range filter's window when the view has one (`bound`, civil ms; null on an
 * open side) — the filter keeps events by their start, so an event running
 * past the filter's end is cut at it rather than stretching the view. Null
 * when nothing is dated.
 */
export function fitDomain(extent: Domain | null, bound: { start: number | null; end: number | null } = { start: null, end: null }): Domain | null {
  if (!extent) return null;
  let start = extent.start;
  let end = extent.end;
  if (bound.start !== null) start = Math.max(start, bound.start);
  if (bound.end !== null) end = Math.min(end, bound.end);
  if (end <= start) ({ start, end } = extent); // a window the events don't meet: fit the events
  const pad = (end - start) * FIT_PADDING;
  let s = start - pad;
  let e = end + pad;
  // The padding never reaches past the filter's window.
  if (bound.start !== null && bound.start <= start) s = Math.max(s, bound.start);
  if (bound.end !== null && bound.end >= end) e = Math.min(e, bound.end);
  return clampDomain({ start: s, end: e });
}

/** The visible domain for a stored range: each pinned side as written, the open sides from Fit. */
export function resolveDomain(pinned: { start: number | null; end: number | null }, fit: Domain | null): Domain {
  const fallback = fit ?? { start: civilMs(new Date().getUTCFullYear(), 0, 1), end: civilMs(new Date().getUTCFullYear() + 1, 0, 1) };
  let start = pinned.start ?? fallback.start;
  let end = pinned.end ?? fallback.end;
  if (end <= start) {
    // One side pinned past where the events end: keep the pinned side, with Fit's width.
    const width = fallback.end - fallback.start;
    if (pinned.start !== null) end = start + width;
    else start = end - width;
  }
  return clampDomain({ start, end });
}

export interface Tick {
  t: number;
  label: string;
}

/** The unit ticks step by, from their spacing (or the view's width when there is one tick). */
export function tickUnit(step: number): TickUnit {
  if (step >= 360 * DAY) return 'year';
  if (step >= 28 * DAY) return 'month';
  if (step >= DAY) return 'day';
  if (step >= HOUR) return 'hour';
  if (step >= MINUTE) return 'minute';
  return 'second';
}

/** The next unit up turns over at `t`: a tick that carries the year (or day) as context. */
function turnsOver(t: number, unit: TickUnit): boolean {
  const d = new Date(t);
  if (unit === 'month') return d.getUTCMonth() === 0;
  if (unit === 'day') return d.getUTCMonth() === 0 && d.getUTCDate() === 1;
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
}

/**
 * Year ticks every `every` years, on round *historical* years (#2698).
 * `utcTicks` steps on round astronomical years, where year 0 is 1 BC and −100
 * is 101 BC, so a BC axis read "101 BC · 1 BC · AD 100". Here BC ticks fall on
 * astronomical 1 − k·every, so they read "every BC, 2·every BC, …"; AD ticks stay
 * on multiples of `every`; and AD 1 is the boundary tick, so the axis reads
 * "20 BC · 10 BC · AD 1 · AD 10 · AD 20".
 */
function historicalYearTicks(d: Domain, every: number): number[] {
  const y0 = civilYear(d.start);
  const y1 = civilYear(d.end);
  const years: number[] = [];
  // BC: astronomical 1 − k·every, k ≥ 1, within [y0, y1].
  for (let k = Math.max(1, Math.ceil((1 - y1) / every)); 1 - k * every >= y0; k++) years.push(1 - k * every);
  years.reverse();
  if (y0 <= 1 && 1 <= y1) years.push(1);
  // AD: multiples of `every`, k ≥ 1.
  for (let k = Math.max(1, Math.ceil(y0 / every)); k * every <= y1; k++) years.push(k * every);
  return years.map((y) => civilMs(y, 0, 1)).filter((t) => t >= d.start && t <= d.end);
}

/**
 * Ticks for a view `width` px wide: about one per `spacing` px, from
 * `utcTicks`, labelled for their unit — days → months → years (decades and
 * centuries are years stepping by 10 or 100). The first tick, and each where
 * the next unit up turns over, carries that unit too.
 */
export function axisTicks(d: Domain, width: number, opts: { spacing?: number; locale?: string } = {}): { unit: TickUnit; ticks: Tick[] } {
  const count = Math.max(2, Math.floor(width / (opts.spacing ?? 100)));
  const dates = utcTicks(new Date(d.start), new Date(d.end), count);
  let ts = dates.map((x) => x.getTime()).filter((t) => Number.isFinite(t));
  const step = ts.length > 1 ? ts[1]! - ts[0]! : d.end - d.start;
  const unit = tickUnit(step);
  const era = civilYear(d.start) <= 0;
  if (unit === 'year' && era && ts.length > 1) {
    const every = civilYear(ts[1]!) - civilYear(ts[0]!);
    if (every >= 2) ts = historicalYearTicks(d, every);
  }
  return {
    unit,
    ticks: ts.map((t, i) => ({
      t,
      label: formatTick(t, unit, { withContext: unit !== 'year' && (i === 0 || turnsOver(t, unit)), era, ...(opts.locale ? { locale: opts.locale } : {}) }),
    })),
  };
}
