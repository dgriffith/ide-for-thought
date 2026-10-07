/**
 * Date precision (#2611, epic #2606): what a date property's written value
 * *means* as a stretch of time. Decided in the Timeline design spike — see
 * `docs/vision/objects-expansion.md`, "Timeline" — and written here so the
 * Timeline layout, a later Calendar layout and the `datetime` property type
 * (#2613) share one reading. Nothing in this file knows about axes, lanes or
 * pixels.
 *
 * **A value is a span, never a fake instant.** `1969` is all of 1969,
 * `1969-07` all of July 1969, `1969-07-20` that whole day: each becomes the
 * half-open span [start, end) of its own precision. A clock time
 * (`1969-07-20T20:17`) is a span of its last written unit — the minute,
 * second or millisecond.
 *
 * **The civil axis.** Spans are milliseconds on a *civil* (wall-clock) axis:
 * the value's own calendar fields encoded as if they were UTC (`Date.UTC`
 * semantics, minus its two-digit-year trap). So `1969-07-20` starts at
 * `Date.UTC(1969, 6, 20)` on every machine, whatever the viewer's zone, and a
 * day is always 86,400,000 ms (no DST gaps). Draw it with UTC-mode tools
 * (`d3-scale`'s `scaleUtc`, `d3-time`'s `utc*` intervals, `Intl` with
 * `timeZone: 'UTC'`), never local-mode ones, or every date shifts by the
 * viewer's offset.
 *
 * **Floating time, unless an offset is written** (#2613's decision). A clock
 * time with no offset is wall-clock time and maps straight onto the civil
 * axis. One with `Z` or `±HH:MM` is an instant: it's placed at the viewer's
 * wall-clock reading of that instant, through `zoneOffsetMinutes` (default:
 * the runtime's local zone). That's the only input that depends on where the
 * viewer is, and it's injectable.
 *
 * **Years.** Proleptic Gregorian, astronomical numbering as ISO 8601, XSD 1.1
 * and JS `Date` all use: year `0000` is 1 BCE, `-0043` is 44 BCE. In a month,
 * day or clock value the year is four unsigned digits (`0000`–`9999`) or ISO
 * 8601's expanded form — a sign and 4–6 digits (`-0043-03-15`,
 * `+12026-01-01`). **A year on its own is any integer of up to six digits**
 * (`44`, `-43`, `12026`), because that is what the frontmatter parser hands
 * over for an unquoted `date: 0044`, `date: -0043` or `date: +12026` — YAML
 * reads each as a number, and `String(-43)` is `-43`. All within the range JS
 * `Date` can hold (-271821-04-20 to +275760-09-13); a value whose span would
 * fall outside it is invalid. `-0000` is not a year (as in ECMAScript).
 *
 * Anything else is invalid and parses to `null` — no guessing, no rolling
 * over (`1969-02-30` is not 2 March), no `Date.parse` (which reads a bare
 * `1969-07-20T20:17` as the *runtime's* local time and `0044` as 1944).
 */

/** Calendar precisions draw as whole days/months/years; clock precisions
 *  carry a time of day. */
export type CalendarPrecision = 'year' | 'month' | 'day';
export type ClockPrecision = 'minute' | 'second' | 'millisecond';
export type DatePrecision = CalendarPrecision | ClockPrecision;

/** Coarsest first — `PRECISION_ORDER.indexOf` compares two precisions. */
export const PRECISION_ORDER: readonly DatePrecision[] = ['year', 'month', 'day', 'minute', 'second', 'millisecond'];

export function isClockPrecision(p: DatePrecision): p is ClockPrecision {
  return p === 'minute' || p === 'second' || p === 'millisecond';
}

/** A value's written fields. Unwritten fields are absent, not zero. */
export interface ParsedDate {
  precision: DatePrecision;
  /** Astronomical: 0 is 1 BCE, -43 is 44 BCE. */
  year: number;
  /** 1–12. */
  month?: number;
  /** 1–31, valid for its month and year. */
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
  millisecond?: number;
  /** Minutes east of UTC when the value wrote an offset (`Z` is 0); null for
   *  a floating (wall-clock) value and for every calendar precision. */
  offsetMinutes: number | null;
}

/** A half-open stretch [start, end) of the civil axis, in ms. */
export interface CivilSpan {
  start: number;
  end: number;
  precision: DatePrecision;
}

export interface SpanOptions {
  /**
   * The viewer's zone, as minutes east of UTC at a given instant (ms). Used
   * only for a value that wrote an offset. Defaults to the runtime's local
   * zone; inject it to be deterministic.
   */
  zoneOffsetMinutes?: (instantMs: number) => number;
}

const localZoneOffset = (instantMs: number): number => -new Date(instantMs).getTimezoneOffset();

/** A year alone: any integer of up to six digits (see the header). */
const YEAR_ONLY_RE = /^[+-]?\d{1,6}$/;
/** A month, day or clock value: the year in ISO 8601's basic or expanded form. */
const VALUE_RE =
  /^([+-]\d{4,6}|\d{4})-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?)?$/;

/** Read a written date value, or null when it isn't one (see the header). */
export function parseDateValue(raw: string | null | undefined): ParsedDate | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (YEAR_ONLY_RE.test(text)) {
    if (/^-0+$/.test(text)) return null;
    return checked({ precision: 'year', year: Number(text), offsetMinutes: null });
  }
  const m = VALUE_RE.exec(text);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, frac, zone] = m;
  if (/^-0+$/.test(y!)) return null;
  const year = Number(y);
  const month = Number(mo);
  if (month < 1 || month > 12) return null;
  if (d === undefined) return checked({ precision: 'month', year, month, offsetMinutes: null });

  const day = Number(d);
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hh === undefined) return checked({ precision: 'day', year, month, day, offsetMinutes: null });

  const hour = Number(hh);
  const minute = Number(mi);
  if (hour > 23 || minute > 59) return null;
  const offsetMinutes = zone === undefined ? null : parseOffset(zone);
  if (zone !== undefined && offsetMinutes === null) return null;
  const base = { year, month, day, hour, minute, offsetMinutes };
  if (ss === undefined) return checked({ precision: 'minute', ...base });

  const second = Number(ss);
  if (second > 59) return null; // no leap seconds: JS time has none
  if (frac === undefined) return checked({ precision: 'second', ...base, second });
  return checked({ precision: 'millisecond', ...base, second, millisecond: Number(frac.padEnd(3, '0')) });
}

/** `Z` → 0, `+05:30` → 330, `-08:00` → -480; null past ±14:00 / :59. */
function parseOffset(zone: string): number | null {
  if (zone === 'Z') return 0;
  const sign = zone[0] === '-' ? -1 : 1;
  const h = Number(zone.slice(1, 3));
  const mm = Number(zone.slice(4, 6));
  if (h > 14 || mm > 59 || (h === 14 && mm > 0)) return null;
  return sign * (h * 60 + mm);
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** Null when the value's span leaves the range JS `Date` can represent. */
function checked(p: ParsedDate): ParsedDate | null {
  return spanOfParsed(p, { zoneOffsetMinutes: () => 0 }) ? p : null;
}

/** The furthest JS `Date` reaches either side of 1970, in ms. */
export const MAX_CIVIL_MS = 8.64e15;

/**
 * Civil-axis ms for a calendar date (month 0-based, overflow rolls as in
 * `Date`). Unlike `Date.UTC`, years 0–99 are years 0–99, not 1900–1999.
 * NaN outside the range `Date` can hold.
 */
export function civilMs(year: number, month0: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month0, day);
  d.setUTCHours(hour, minute, second, ms);
  return d.getTime();
}

/** The value's own span: its start, and the start of its next unit. */
export function spanOfParsed(p: ParsedDate, opts: SpanOptions = {}): CivilSpan | null {
  const mo = (p.month ?? 1) - 1;
  const day = p.day ?? 1;
  let start: number;
  let end: number;
  switch (p.precision) {
    case 'year':
      start = civilMs(p.year, 0, 1);
      end = civilMs(p.year + 1, 0, 1);
      break;
    case 'month':
      start = civilMs(p.year, mo, 1);
      end = civilMs(p.year, mo + 1, 1);
      break;
    case 'day':
      start = civilMs(p.year, mo, day);
      end = civilMs(p.year, mo, day + 1);
      break;
    default: {
      const wall = civilMs(p.year, mo, day, p.hour, p.minute, p.second ?? 0, p.millisecond ?? 0);
      if (p.offsetMinutes === null) {
        start = wall;
      } else {
        // An instant: back to UTC with the written offset, then forward to
        // the viewer's wall clock.
        const instant = wall - p.offsetMinutes * 60_000;
        start = instant + (opts.zoneOffsetMinutes ?? localZoneOffset)(instant) * 60_000;
      }
      end = start + (p.precision === 'minute' ? 60_000 : p.precision === 'second' ? 1_000 : 1);
    }
  }
  const inRange = (t: number) => Number.isFinite(t) && Math.abs(t) <= MAX_CIVIL_MS;
  return inRange(start) && inRange(end) ? { start, end, precision: p.precision } : null;
}

/** `dateSpan('1969')` → all of 1969; null for an empty or invalid value. */
export function dateSpan(raw: string | null | undefined, opts: SpanOptions = {}): CivilSpan | null {
  const p = parseDateValue(raw);
  return p ? spanOfParsed(p, opts) : null;
}

/** What became of a range's end. */
export type EndIssue =
  /** Written, but not a date (see `parseDateValue`). */
  | 'invalid'
  /** Ends at or before its start begins (`date: 1970`, `end: 1969`). */
  | 'before-start';

export interface DateRange {
  /** Civil ms. `start` is always the start value's own span start. */
  start: number;
  /** Civil ms, exclusive, > start. Without a usable end, the start's span end. */
  end: number;
  /** The start value's own span — the stretch where the start is uncertain. */
  startSpan: CivilSpan;
  /** The end value's own span when a usable end was written, else null. */
  endSpan: CivilSpan | null;
  /** Why a written end was set aside; null when it was used or not written. */
  endIssue: EndIssue | null;
}

export type DateRangeResult =
  | { ok: true; range: DateRange }
  /** `missing`: no start written (the Undated tray). `invalid`: a start that
   *  isn't a date — still undated, but worth saying why. */
  | { ok: false; reason: 'missing' | 'invalid' };

/**
 * A start value and an optional end value as one stretch of the civil axis.
 *
 * - The range starts where the start's own span starts.
 * - **An end at calendar precision is inclusive of its whole span**: `end:
 *   1969-07-24` runs through the 24th, and an end coarser than its start
 *   (`date: 1969-07-20`, `end: 1970`) runs to the end of 1970. **An end at
 *   clock precision is the instant itself**: 14:30–16:00 ends at 16:00, not
 *   16:01.
 * - **An end that doesn't come after the start's beginning is set aside**,
 *   not swapped and not fatal: the range is the start's own span, flagged
 *   `before-start` so a caller can say so. Same for an end that isn't a date
 *   (`invalid`). A start alone is never lost because its end is wrong.
 * - An end may fall inside the start's own span (`date: 1969`, `end:
 *   1969-03` runs January–March): the end narrows how long it can have lasted.
 */
export function dateRange(
  startRaw: string | null | undefined,
  endRaw?: string | null,
  opts: SpanOptions = {},
): DateRangeResult {
  if (isBlank(startRaw)) return { ok: false, reason: 'missing' };
  const startSpan = dateSpan(startRaw, opts);
  if (!startSpan) return { ok: false, reason: 'invalid' };
  const alone = (endIssue: EndIssue | null): DateRangeResult =>
    ({ ok: true, range: { start: startSpan.start, end: startSpan.end, startSpan, endSpan: null, endIssue } });
  if (isBlank(endRaw)) return alone(null);
  const endSpan = dateSpan(endRaw, opts);
  if (!endSpan) return alone('invalid');
  const end = isClockPrecision(endSpan.precision) ? endSpan.start : endSpan.end;
  if (end <= startSpan.start) return alone('before-start');
  return { ok: true, range: { start: startSpan.start, end, startSpan, endSpan, endIssue: null } };
}

function isBlank(raw: string | null | undefined): boolean {
  return raw === null || raw === undefined || raw.trim() === '';
}
