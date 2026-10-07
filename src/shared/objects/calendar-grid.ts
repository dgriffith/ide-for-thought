/**
 * Month-grid date maths for the Calendar layout (#2700, epic #2699): which
 * days a month page shows, where an event's days fall in its week rows, and
 * how the segments of one row stack. Decided in the Calendar design story
 * (`docs/vision/objects-expansion.md`, "Calendar"); the layout that draws the
 * grid is #2702's. Nothing here knows about pixels or the DOM.
 *
 * **Days are civil days.** Everything is on `date-precision.ts`'s civil axis:
 * calendar fields encoded as UTC ms, so a day is always `DAY_MS` long, a DST
 * change never makes a 23- or 25-hour day, and a grid is the same for every
 * viewer. An event that wrote an offset was already moved onto the viewer's
 * wall clock by `dateRange`, so it lands on the viewer's local day without
 * anything here knowing about zones. Years are proleptic Gregorian and
 * astronomical (`0` is 1 BCE), as everywhere else.
 *
 * **Week start** is a weekday in `Intl.Locale.prototype.getWeekInfo()`'s
 * numbering: 1 = Monday … 7 = Sunday. Where it comes from (the locale, or a
 * setting) is the caller's business.
 *
 * **Placement** follows the event's START precision (`placementOf`): a day or
 * a clock time sits in the grid's cells; a start known only to the month goes
 * in the month band of every month page its range touches; one known only to
 * the year goes in the year band the same way. A day start with a coarser end
 * (`date: 1969-07-20`, `end: 1969-08`) is a bar in the cells, uncertain over
 * its end's span (`uncertainFrom`), as the Timeline hatches it.
 *
 * **Segments.** A range covers every civil day its half-open [start, end)
 * meets, so a clock end at exactly midnight doesn't spill into the next day.
 * `segmentByWeek` cuts that run of days at each week row, flagging a segment
 * that continues from the row before or into the row after.
 *
 * **Slots.** `layoutMonth` packs each row's segments with `packLanes`
 * (`interval-lanes.ts`) in whole days, so a segment holds ONE slot across
 * every day it covers within its row — the consistency comes from packing
 * the segment as one interval, not from matching days afterwards. Segments
 * are taken in order of first day, then last day, then the event's start
 * time, then title, then key; first-fit then uses the fewest slots any
 * stacking can (the most events sharing one day). A bar continuing into the
 * next row is packed afresh there, so its slot may change between rows.
 *
 * **Overflow** (`overflowRow`): a cell holds `capacity` single-line slots.
 * A day whose segments all fit shows them all. A day that doesn't keeps its
 * last slot for "+N more" and shows only what sits above it — and a bar is
 * never drawn in pieces: one that would cross an overflowing day is hidden
 * on every day of its segment and counted in each day's "+N more".
 */
import { civilMs, parseDateValue, type CivilSpan } from './date-precision';
import { packLanes } from './interval-lanes';
import { DAY_MS } from '../time';

/** `getWeekInfo().firstDay`'s numbering: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A month page: astronomical year, month 1–12. */
export interface CalendarMonth {
  year: number;
  month: number;
}

export interface GridDay {
  /** Civil ms at the start of the day. */
  start: number;
  year: number;
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
  weekday: Weekday;
  /** In the page's month (else a leading or trailing day, shown dimmed). */
  inMonth: boolean;
}

export interface GridWeek {
  /** Civil ms: the row's first day, and the day after its last. */
  start: number;
  end: number;
  /** Seven days, in column order. */
  days: GridDay[];
}

// ── Days ─────────────────────────────────────────────────────────────────

/** The civil day containing `ms` (its start). */
export function dayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** The weekday of the civil day containing `ms`. */
export function weekdayOf(ms: number): Weekday {
  const d = new Date(dayStart(ms)).getUTCDay(); // 0 = Sunday
  return (d === 0 ? 7 : d) as Weekday;
}

function gridDay(start: number, page: CalendarMonth): GridDay {
  const d = new Date(start);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return { start, year, month, day: d.getUTCDate(), weekday: weekdayOf(start), inMonth: year === page.year && month === page.month };
}

/** Days from `weekStart` back to the weekday of `ms` (0–6). */
function daysIntoWeek(ms: number, weekStart: Weekday): number {
  return (weekdayOf(ms) - weekStart + 7) % 7;
}

// ── Months ───────────────────────────────────────────────────────────────

/** The month `n` months after `m` (negative goes back). */
export function addMonths(m: CalendarMonth, n: number): CalendarMonth {
  const i = m.year * 12 + (m.month - 1) + n;
  const year = Math.floor(i / 12);
  return { year, month: i - year * 12 + 1 };
}

/** The month containing civil ms `ms`. */
export function monthOf(ms: number): CalendarMonth {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Civil ms: the month's first day, and the first day of the next. */
export function monthBounds(m: CalendarMonth): { start: number; end: number } {
  return { start: civilMs(m.year, m.month - 1, 1), end: civilMs(m.year, m.month, 1) };
}

/**
 * A month anchor as a view spec writes it (`month: "2026-10"`, #2701): the
 * date grammar's month precision, so `-0043-03` is March 44 BCE and
 * `+12026-01` is legal. Untrusted input, so never throws: anything that isn't
 * a month-precision value is null.
 */
export function parseMonthAnchor(raw: unknown): CalendarMonth | null {
  if (typeof raw !== 'string') return null;
  const p = parseDateValue(raw);
  return p && p.precision === 'month' ? { year: p.year, month: p.month! } : null;
}

/** The anchor text for a month: `2026-10`, `-0043-03`, `+12026-01`. */
export function formatMonthAnchor(m: CalendarMonth): string {
  const digits = String(Math.abs(m.year)).padStart(4, '0');
  const y = m.year < 0 ? `-${digits}` : m.year > 9999 ? `+${digits}` : digits;
  return `${y}-${String(m.month).padStart(2, '0')}`;
}

/**
 * The week rows of a month page: every week that holds a day of the month,
 * from the week containing the 1st to the week containing the last day — 4,
 * 5 or 6 rows — with the leading and trailing days of the neighbouring months
 * that complete them.
 */
export function monthWeeks(m: CalendarMonth, weekStart: Weekday): GridWeek[] {
  const { start, end } = monthBounds(m);
  const first = start - daysIntoWeek(start, weekStart) * DAY_MS;
  const weeks: GridWeek[] = [];
  for (let w = first; w < end; w += 7 * DAY_MS) {
    const days: GridDay[] = [];
    for (let i = 0; i < 7; i++) days.push(gridDay(w + i * DAY_MS, m));
    weeks.push({ start: w, end: w + 7 * DAY_MS, days });
  }
  return weeks;
}

// ── Week numbers ─────────────────────────────────────────────────────────

/** The ISO 8601 week of the civil day containing `ms`: its week-numbering
 *  year (which differs from the calendar year near 1 January) and week 1–53. */
export function isoWeekOf(ms: number): { year: number; week: number } {
  const day = dayStart(ms);
  const thursday = day + (4 - weekdayOf(day)) * DAY_MS; // the week's Thursday decides its year
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - civilMs(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return { year, week };
}

/**
 * The ISO week number a row is labelled with: the ISO week of the row's
 * Thursday. With a Monday week start the row IS that ISO week; with any other
 * start it is the ISO week that holds most of the row's days (6 of 7 for a
 * Sunday start, 5 of 7 for a Saturday start).
 */
export function rowWeekNumber(week: GridWeek): { year: number; week: number } {
  const thursday = week.days.find((d) => d.weekday === 4)!;
  return isoWeekOf(thursday.start);
}

// ── Keyboard movement between days (WAI-ARIA date grid) ─────────────────

/** `n` days on (arrows: ±1, ±7). Civil days are uniform, so this is exact. */
export function addDays(dayMs: number, n: number): number {
  return dayStart(dayMs) + n * DAY_MS;
}

/**
 * The same day of the month `n` months on, clamped to that month's last day
 * (Page Up/Down: n = ∓1; Shift+Page Up/Down: n = ∓12). 31 January → 28 or 29
 * February; 29 February → 28 February a year on.
 */
export function addMonthsClamped(dayMs: number, n: number): number {
  const d = new Date(dayStart(dayMs));
  const target = addMonths({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }, n);
  const { start, end } = monthBounds(target);
  const lastDay = (end - start) / DAY_MS;
  return civilMs(target.year, target.month - 1, Math.min(d.getUTCDate(), lastDay));
}

/** Home/End: the first or last day of the row (week) containing `dayMs`. */
export function weekEdge(dayMs: number, weekStart: Weekday, edge: 'start' | 'end'): number {
  const first = dayStart(dayMs) - daysIntoWeek(dayMs, weekStart) * DAY_MS;
  return edge === 'start' ? first : first + 6 * DAY_MS;
}

// ── Placement ────────────────────────────────────────────────────────────

/** Where an event goes on a month page, by its start's precision. */
export type CalendarPlacement =
  /** A day or clock start: in the cells. */
  | 'grid'
  /** A month start (`1969-07`): the month band. */
  | 'month'
  /** A year start (`1969`): the year band. */
  | 'year';

/** The part of `dateRange`'s result a calendar reads. */
export interface CalendarRange {
  start: number;
  end: number;
  startSpan: CivilSpan;
  endSpan: CivilSpan | null;
}

export function placementOf(range: Pick<CalendarRange, 'startSpan'>): CalendarPlacement {
  const p = range.startSpan.precision;
  return p === 'year' ? 'year' : p === 'month' ? 'month' : 'grid';
}

/** Does the range meet [start, end) — a month, a page, a row? */
export function rangeMeets(range: Pick<CalendarRange, 'start' | 'end'>, start: number, end: number): boolean {
  return range.start < end && range.end > start;
}

/**
 * Where a grid event becomes uncertain: the start of its end's span when the
 * end is coarser than a day (`end: 1969-08` → 1 August), else null. A grid
 * event's start is always at least a day, so it is never uncertain.
 */
export function uncertainFrom(range: Pick<CalendarRange, 'endSpan'>): number | null {
  const p = range.endSpan?.precision;
  return p === 'year' || p === 'month' ? range.endSpan!.start : null;
}

// ── Segments ─────────────────────────────────────────────────────────────

export interface WeekSegment {
  /** Index into the page's weeks. */
  row: number;
  /** Columns 0–6: first day covered, and one past the last. */
  startCol: number;
  endCol: number;
  /** The event began in an earlier row (or before the page). */
  continuesBefore: boolean;
  /** The event goes on into a later row (or past the page). */
  continuesAfter: boolean;
  /** The first column drawn as uncertain, or null when none is. */
  uncertainFromCol: number | null;
}

/** The civil days [first, last] a half-open range meets. */
export function coveredDays(range: Pick<CalendarRange, 'start' | 'end'>): { first: number; last: number } {
  return { first: dayStart(range.start), last: dayStart(range.end - 1) };
}

/**
 * The range cut into one segment per week row it meets (none when it misses
 * the page). `uncertain` is where the range becomes uncertain (`uncertainFrom`).
 */
export function segmentByWeek(
  range: Pick<CalendarRange, 'start' | 'end'>,
  weeks: readonly GridWeek[],
  uncertain: number | null = null,
): WeekSegment[] {
  if (!(range.end > range.start)) return [];
  const { first, last } = coveredDays(range);
  const out: WeekSegment[] = [];
  weeks.forEach((w, row) => {
    const from = Math.max(first, w.start);
    const to = Math.min(last, w.end - DAY_MS);
    if (from > to) return;
    const startCol = (from - w.start) / DAY_MS;
    const endCol = (to - w.start) / DAY_MS + 1;
    let uncertainFromCol: number | null = null;
    if (uncertain !== null && uncertain <= to) uncertainFromCol = Math.max(startCol, (dayStart(uncertain) - w.start) / DAY_MS);
    out.push({ row, startCol, endCol, continuesBefore: first < from, continuesAfter: last > to, uncertainFromCol });
  });
  return out;
}

// ── Stacking within a row ────────────────────────────────────────────────

/** An event the grid places: a `grid`-placement range, with its identity. */
export interface CalendarItem {
  /** The note path — unique, the final tie-break. */
  key: string;
  title: string;
  range: Pick<CalendarRange, 'start' | 'end' | 'endSpan'>;
}

export interface PlacedSegment extends WeekSegment {
  key: string;
  /** The vertical slot, the same across every day the segment covers. */
  slot: number;
}

export interface RowLayout {
  row: number;
  /** In stacking order (first day, last day, start time, title, key). */
  segments: PlacedSegment[];
  /** Slots the row needs: the most segments sharing one of its days. */
  slotCount: number;
}

/** The time of day a range starts (ms past midnight), zero-padded for sorting. */
function timeKey(start: number): string {
  return String(start - dayStart(start)).padStart(8, '0');
}

/** Every row's segments, with slots from `packLanes` in whole days. */
export function layoutMonth(items: readonly CalendarItem[], weeks: readonly GridWeek[]): RowLayout[] {
  const perRow: { seg: WeekSegment; item: CalendarItem }[][] = weeks.map(() => []);
  for (const item of items) {
    for (const seg of segmentByWeek(item.range, weeks, uncertainFrom(item.range))) perRow[seg.row]!.push({ seg, item });
  }
  return perRow.map((entries, row) => {
    const byKey = new Map(entries.map((e) => [e.item.key, e] as const));
    // A segment that continues from an earlier row sorts as starting at
    // midnight; otherwise ties on the same days order by the start time.
    const packing = packLanes(entries.map(({ seg, item }) => ({
      key: item.key,
      start: seg.startCol,
      end: seg.endCol,
      title: `${seg.continuesBefore ? timeKey(0) : timeKey(item.range.start)}\u0000${item.title}`,
    })));
    const segments = packing.order.map((key) => {
      const { seg } = byKey.get(key)!;
      return { ...seg, key, slot: packing.lanes.get(key)! };
    });
    return { row, segments, slotCount: packing.laneCount };
  });
}

// ── Overflow ─────────────────────────────────────────────────────────────

export interface RowOverflow {
  /** Segments drawn in the row, each whole. */
  visible: PlacedSegment[];
  /** Per column 0–6: how many of that day's events "+N more" stands for (0 = none). */
  more: number[];
}

/**
 * What a row draws when a cell holds `capacity` single-line slots (the
 * "+N more" line, when needed, takes the last). See the header.
 */
export function overflowRow(row: RowLayout, capacity: number): RowOverflow {
  const cap = Math.max(0, Math.floor(capacity));
  const overflowing = new Array<boolean>(7).fill(false);
  for (const s of row.segments) {
    if (s.slot >= cap) for (let c = s.startCol; c < s.endCol; c++) overflowing[c] = true;
  }
  const shown = (s: PlacedSegment): boolean => {
    if (s.slot >= cap) return false;
    if (s.slot < cap - 1) return true;
    for (let c = s.startCol; c < s.endCol; c++) if (overflowing[c]) return false;
    return true;
  };
  const visible: PlacedSegment[] = [];
  const more = new Array<number>(7).fill(0);
  for (const s of row.segments) {
    if (shown(s)) visible.push(s);
    else for (let c = s.startCol; c < s.endCol; c++) more[c]!++;
  }
  return { visible, more };
}
