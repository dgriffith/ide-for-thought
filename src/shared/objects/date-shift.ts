/**
 * Rescheduling a dated event by whole days (#2700, epic #2699) — the rule the
 * Calendar's drag and *Move to date…* (#2703) write through. Decided in the
 * Calendar design story (`docs/vision/objects-expansion.md`, "Calendar").
 * Pure: it turns written values into written values; the frontmatter write
 * (Kanban's `applyBulkEdits` path, #2603) is the caller's.
 *
 * **A move is a whole number of days.** A drag goes from one day cell to
 * another and *Move to date…* names a day, so there is no "move by a month"
 * and nothing ever needs clamping: 31 January moved 29 days is 1 March (or 29
 * February in a leap year), 29 February moved a year's worth of days lands on
 * whatever day that is. Days are civil days (`date-precision.ts`), so a DST
 * change in between makes no difference to a date or a floating time.
 *
 * **Precision is kept, and so is everything else that was written.** Only the
 * `YYYY-MM-DD` part of a value changes:
 * - a date stays a date (`2026-10-05` → `2026-10-07`);
 * - a clock value keeps its time of day exactly as written — seconds, a
 *   fraction, and a `Z` or `±HH:MM` offset are copied, never normalised;
 * - the year keeps its written form: four digits while it fits, an expanded
 *   `±YYYYY` when it was written that way or must be (`-0001-12-31` + 1 day
 *   is `0000-01-01`; `9999-12-31` + 1 day is `+10000-01-01`).
 *
 * **Duration is kept: the end moves by the same days as the start.** For a
 * date or a floating time that is the same wall-clock length; for an offset
 * time it is the same elapsed time, since the written offsets don't move.
 *
 * **What can't be moved** (`{ ok: false, reason }`), so the caller says why
 * instead of writing something the user didn't mean:
 * - `not-a-day`: the start is only a month or a year (`1969-07`, `1969`).
 *   There's no day to drag it from, so it isn't draggable; open it to edit.
 * - `end-not-a-day`: the end is only a month or a year. Keeping its precision
 *   and moving it by days are incompatible, so the same answer.
 * - `invalid`: the start isn't a date (such an event is in the Undated tray
 *   and can't be dragged anyway).
 * - `out-of-range`: the result is outside the years JS `Date` holds.
 * An end that is written but isn't a date is left exactly as written.
 *
 * **Offset times land on the day the viewer dropped them on.** An offset
 * value shows on the viewer's local day (#2613). Moving its written date by N
 * days moves the instant by N × 24 h, and the viewer's zone may change offset
 * in between (DST): an event at 23:30 local can then show at 00:30 a day later
 * than the drop. So for an offset start the day count is corrected by ±1 to
 * put the start on the target local day; the end moves by the same corrected
 * count. Where the zone springs forward a time close to midnight can skip a
 * local day altogether (in London, 23:30Z shows on 28 March 2026 and then on
 * 30 March); no whole-day move reaches the skipped day, so the uncorrected
 * move stands and the event shows a day past the drop.
 *
 * ## By minutes (#2953): the Week and Day grids
 *
 * `retimeByMinutes` moves an event's start and end by whole minutes, a drop
 * on another day included (`days × 1440 + minutes`); `resizeByMinutes` moves
 * the end alone. Both count on the viewer's wall clock: the event lands where
 * the user dropped it, as seen.
 * - **Only a clock start moves by minutes.** A day start refuses `no-time`
 *   ("… has no time to move"; it still moves by days), and a month or year
 *   start `not-a-day`, as above. A drop into the hours never promotes a date
 *   to a time: that would write a time the user didn't write.
 * - **A clock value keeps its form**: its precision, any seconds or fraction,
 *   and its offset as written. A floating value moves on its own wall clock;
 *   an offset value is written in its own offset at the instant that shows at
 *   the target wall-clock time for this viewer, so a move across a DST change
 *   keeps the time dropped on. (A target inside a spring-forward gap has no
 *   such instant and lands an hour off, where the zone puts it.)
 * - **The end follows a retime**: a clock end by the same wall-clock minutes,
 *   a day end by the days the start's date moved; a month or year end refuses
 *   `end-not-a-day`. None written, or not a date, is left alone.
 * - **A resize writes the end.** A clock end moves by the minutes; an end
 *   never written, or one coarser than a clock time (which the grid drew
 *   `DEFAULT_TIMED_MINUTES` long), is created at its drawn end plus the
 *   minutes, in the start's form. An end at or before the start refuses
 *   `end-before-start`.
 */
import { isClockPrecision, parseDateValue, spanOfParsed, type ParsedDate, type SpanOptions } from './date-precision';
import { dayStart } from './calendar-grid';
import { DAY_MS } from '../time';

/** The date part and the rest (`T…` onwards, verbatim) of a written value. */
const SPLIT_RE = /^([+-]?\d+)-(\d{2})-(\d{2})(T.*)?$/;

/**
 * `raw` moved by `days` whole days, keeping its precision and written form
 * (see the header). Null for a value that isn't a day or finer, a non-integer
 * `days`, or a result outside `Date`'s range.
 */
export function shiftDateValue(raw: string, days: number): string | null {
  if (!Number.isInteger(days)) return null;
  const text = raw.trim();
  const p = parseDateValue(text);
  if (!p || p.precision === 'year' || p.precision === 'month') return null;
  if (days === 0) return text;
  const m = SPLIT_RE.exec(text)!;
  const [, yearText, , , rest] = m;
  const d = new Date(0);
  d.setUTCFullYear(p.year, p.month! - 1, p.day! + days);
  if (!Number.isFinite(d.getTime())) return null;
  const out = `${formatYear(d.getUTCFullYear(), yearText!)}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}${rest ?? ''}`;
  return parseDateValue(out) ? out : null;
}

/**
 * A year in the form `written` used. A `-` is the year's sign, not a style;
 * a `+`, or more than four digits, is ISO's expanded form, kept with its digit
 * count. Otherwise four digits, expanding only when the year needs it
 * (negative, or past 9999).
 */
function formatYear(year: number, written: string): string {
  const digitsWritten = written.replace(/^[+-]/, '').length;
  const expanded = written.startsWith('+') || digitsWritten > 4;
  const digits = String(Math.abs(year)).padStart(expanded ? digitsWritten : 4, '0');
  if (year < 0) return `-${digits}`;
  if (expanded || year > 9999) return `+${digits}`;
  return digits;
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

export type RescheduleRefusal = 'not-a-day' | 'end-not-a-day' | 'invalid' | 'out-of-range' | 'no-time' | 'end-before-start';

export type RescheduleResult =
  | {
      ok: true;
      /** The start to write. */
      start: string;
      /** The end to write, or null to leave the end field exactly as it is
       *  (none written, or written but not a date). */
      end: string | null;
      /** The days the written values moved by (after the offset correction). */
      days: number;
    }
  | { ok: false; reason: RescheduleRefusal };

/** Is this value a day or finer (draggable)? */
function isDayOrFiner(p: ParsedDate): boolean {
  return p.precision !== 'year' && p.precision !== 'month';
}

/**
 * The civil day (its start, ms) an event's start shows on for this viewer —
 * what a drag starts from and *Move to date…* counts from. Null when the start
 * isn't a day or finer.
 */
export function startDayOf(startRaw: string, opts: SpanOptions = {}): number | null {
  const p = parseDateValue(startRaw);
  if (!p || !isDayOrFiner(p)) return null;
  const span = spanOfParsed(p, opts);
  return span ? dayStart(span.start) : null;
}

/** Can this event be dragged? The refusal `rescheduleByDays` would give, or null. */
export function rescheduleRefusal(startRaw: string, endRaw: string | null | undefined): RescheduleRefusal | null {
  const p = parseDateValue(startRaw);
  if (!p) return 'invalid';
  if (!isDayOrFiner(p)) return 'not-a-day';
  const e = endRaw === null || endRaw === undefined ? null : parseDateValue(endRaw);
  if (e && !isDayOrFiner(e)) return 'end-not-a-day';
  return null;
}

/**
 * Move an event so its start shows `days` days later (earlier when negative)
 * for this viewer, its end following. A drag passes the day under the pointer
 * at release minus the day it was grabbed on — whichever segment of a
 * multi-day bar was grabbed, the whole event moves. *Move to date…* passes
 * the target day minus `startDayOf`.
 */
export function rescheduleByDays(
  startRaw: string,
  endRaw: string | null | undefined,
  days: number,
  opts: SpanOptions = {},
): RescheduleResult {
  const refusal = rescheduleRefusal(startRaw, endRaw);
  if (refusal) return { ok: false, reason: refusal };
  if (!Number.isInteger(days)) return { ok: false, reason: 'invalid' };
  const p = parseDateValue(startRaw)!;
  let d = days;
  if (p.offsetMinutes !== null && days !== 0) {
    // Land on the target local day despite a DST change in between — when
    // some whole-day move can: where the zone springs forward, a time near
    // midnight skips a local day entirely, and the uncorrected move stands.
    const target = startDayOf(startRaw, opts)! + days * DAY_MS;
    const landsOn = (n: number): number | null => {
      const moved = shiftDateValue(startRaw, n);
      return moved === null ? null : startDayOf(moved, opts);
    };
    const landed = landsOn(d);
    if (landed !== null && landed !== target) {
      const corrected = d + (target - landed) / DAY_MS;
      if (landsOn(corrected) === target) d = corrected;
    }
  }
  const start = shiftDateValue(startRaw, d);
  if (start === null) return { ok: false, reason: 'out-of-range' };
  const e = endRaw === null || endRaw === undefined ? null : parseDateValue(endRaw);
  if (!e) return { ok: true, start, end: null, days: d };
  const end = shiftDateValue(endRaw!, d);
  if (end === null) return { ok: false, reason: 'out-of-range' };
  return { ok: true, start, end, days: d };
}

// ── By minutes (#2953) ───────────────────────────────────────────────────

const MINUTE_MS = 60_000;
/** How long the hour grid draws an event with no clock end, in minutes (`time-grid.ts`'s `DEFAULT_TIMED_MINUTES`). */
export const DRAWN_END_MINUTES = 30;
/** A clock value: its date, hours and minutes, and the rest (seconds, fraction, offset) verbatim. */
const CLOCK_RE = /^([+-]?\d+)-\d{2}-\d{2}T\d{2}:\d{2}(.*)$/;

const localZoneOffset = (instantMs: number): number => -new Date(instantMs).getTimezoneOffset();

/** Where a value shows on the viewer's wall clock (civil ms), or null. */
function shownAt(p: ParsedDate, opts: SpanOptions): number | null {
  return spanOfParsed(p, opts)?.start ?? null;
}

/**
 * `form` (a clock value as written) rewritten to show at `target` on the
 * viewer's wall clock: same seconds, fraction and offset. Null outside
 * `Date`'s range.
 */
function writeShownAt(form: string, p: ParsedDate, target: number, opts: SpanOptions): string | null {
  const m = CLOCK_RE.exec(form.trim());
  if (!m) return null;
  let wall = target;
  if (p.offsetMinutes !== null) {
    // The instant that shows at `target` for this viewer, then that instant in the written offset.
    const zone = opts.zoneOffsetMinutes ?? localZoneOffset;
    const guess = target - zone(target) * MINUTE_MS;
    const instant = target - zone(guess) * MINUTE_MS;
    wall = instant + p.offsetMinutes * MINUTE_MS;
  }
  const d = new Date(wall);
  if (!Number.isFinite(d.getTime())) return null;
  const out = `${formatYear(d.getUTCFullYear(), m[1]!)}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}${m[2]}`;
  return parseDateValue(out) ? out : null;
}

/** The refusal for a start that can't move by minutes, or null for a clock start. */
function clockStartRefusal(p: ParsedDate | null): RescheduleRefusal | null {
  if (!p) return 'invalid';
  if (p.precision === 'day') return 'no-time';
  if (!isDayOrFiner(p)) return 'not-a-day';
  return null;
}

/** Can this event move by minutes? The refusal `retimeByMinutes` would give, or null. */
export function retimeRefusal(startRaw: string, endRaw: string | null | undefined): RescheduleRefusal | null {
  const start = clockStartRefusal(parseDateValue(startRaw));
  if (start) return start;
  const e = endRaw === null || endRaw === undefined ? null : parseDateValue(endRaw);
  return e && !isDayOrFiner(e) ? 'end-not-a-day' : null;
}

export type RetimeResult =
  | {
      ok: true;
      start: string;
      /** The end to write, or null to leave the end field as it is. */
      end: string | null;
    }
  | { ok: false; reason: RescheduleRefusal };

/**
 * Move a timed event so it shows `minutes` later (earlier when negative) on
 * the viewer's wall clock, its end following (see the header).
 */
export function retimeByMinutes(
  startRaw: string,
  endRaw: string | null | undefined,
  minutes: number,
  opts: SpanOptions = {},
): RetimeResult {
  const refusal = retimeRefusal(startRaw, endRaw);
  if (refusal) return { ok: false, reason: refusal };
  if (!Number.isInteger(minutes) || minutes === 0) return { ok: false, reason: 'invalid' };
  const p = parseDateValue(startRaw)!;
  const from = shownAt(p, opts);
  const start = from === null ? null : writeShownAt(startRaw, p, from + minutes * MINUTE_MS, opts);
  if (start === null) return { ok: false, reason: 'out-of-range' };
  const e = endRaw === null || endRaw === undefined ? null : parseDateValue(endRaw);
  if (!e) return { ok: true, start, end: null };
  let end: string | null;
  if (isClockPrecision(e.precision)) {
    const endFrom = shownAt(e, opts);
    end = endFrom === null ? null : writeShownAt(endRaw!, e, endFrom + minutes * MINUTE_MS, opts);
  } else {
    // A day end moves by the days the start's written date moved.
    end = shiftDateValue(endRaw!, dayIndex(parseDateValue(start)!) - dayIndex(p));
  }
  if (end === null) return { ok: false, reason: 'out-of-range' };
  return { ok: true, start, end };
}

/** A written day's position on the civil axis, in days. */
function dayIndex(p: ParsedDate): number {
  const d = new Date(0);
  d.setUTCFullYear(p.year, p.month! - 1, p.day);
  return Math.round(d.getTime() / DAY_MS);
}

/** Can this event's end be resized? The refusal `resizeByMinutes` would give for any resize, or null. */
export function resizeRefusal(startRaw: string): RescheduleRefusal | null {
  return clockStartRefusal(parseDateValue(startRaw));
}

/**
 * Move a timed event's end so it shows `minutes` later (earlier when
 * negative) than it is drawn now — creating it, in the start's form, when
 * there's no clock end (see the header). The start is never written.
 */
export function resizeByMinutes(
  startRaw: string,
  endRaw: string | null | undefined,
  minutes: number,
  opts: SpanOptions = {},
): RetimeResult {
  const refusal = resizeRefusal(startRaw);
  if (refusal) return { ok: false, reason: refusal };
  if (!Number.isInteger(minutes) || minutes === 0) return { ok: false, reason: 'invalid' };
  const p = parseDateValue(startRaw)!;
  const from = shownAt(p, opts);
  if (from === null) return { ok: false, reason: 'out-of-range' };
  const e = endRaw === null || endRaw === undefined ? null : parseDateValue(endRaw);
  let end: string | null;
  let endAt: number | null;
  if (e && isClockPrecision(e.precision)) {
    const drawn = shownAt(e, opts);
    endAt = drawn === null ? null : drawn + minutes * MINUTE_MS;
    end = endAt === null ? null : writeShownAt(endRaw!, e, endAt, opts);
  } else {
    // No clock end: the grid drew it DRAWN_END_MINUTES long, not past midnight.
    const drawn = Math.min(from + DRAWN_END_MINUTES * MINUTE_MS, dayStart(from) + DAY_MS);
    endAt = drawn + minutes * MINUTE_MS;
    end = writeShownAt(startRaw, p, endAt, opts);
  }
  if (end === null || endAt === null) return { ok: false, reason: 'out-of-range' };
  const written = shownAt(parseDateValue(end)!, opts);
  if (written === null || written <= from) return { ok: false, reason: 'end-before-start' };
  return { ok: true, start: startRaw.trim(), end };
}
