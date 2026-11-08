/**
 * The Calendar's Week and Day pages (#2950, epic #2949): which events go in
 * the all-day strip and which in the hour grid, where each timed one sits,
 * how overlapping ones share a day's width, and which days a DST change
 * touches. Pure, so it tests without a DOM, like `layoutMonth`; the views
 * that draw it are #2951's and #2952's. The page itself is
 * `calendar-grid.ts`'s `timePage`, one row of 7 days or 1.
 *
 * **Which events go where** (`timeGridPlacement`), over the grid events of
 * `buildCalendarModel` (a month or year start stays in the bands):
 * - a **day** start is all-day — the **strip**, a bar across its days;
 * - a **clock** start that runs **24 hours or more**, or whose coarse end
 *   (`end: 2026-10-08`) falls on a later day, is a strip bar too: a multi-day
 *   stay drawn as a column-tall block would hide the hours of every day it
 *   crosses (the convention of every desktop calendar);
 * - any other clock start is in the **hour grid**, by its start and end.
 *   One that crosses midnight is cut per day, marked as continuing.
 *
 * **An end the grid can't draw** — none written, or one coarser than a
 * clock time on the start's own day — is drawn `DEFAULT_TIMED_MINUTES` long
 * and `endKnown: false`, for the view to hatch as the month grid hatches an
 * approximate end. That invented stretch stops at midnight: it never draws
 * onto a day the note doesn't name.
 *
 * **Overlaps** (`layoutDay`): a day's pieces are packed by `packLanes` in
 * minutes, each holding at least `minMinutes` so a five-minute event still
 * claims its line. Pieces whose drawn extents chain into each other form a
 * cluster, and every piece of a cluster divides the column by the cluster's
 * lane count — an event overlapping nothing keeps the whole width.
 *
 * **DST** (`dstNote`): the grid always draws 24 equal hours. The civil axis
 * has no 23- or 25-hour day (`calendar-grid.ts`), so a day whose viewer
 * offset changes is reported as the wall-clock stretch that was skipped
 * (spring) or happened twice (autumn), for the view to mark — not a column
 * of a different height.
 *
 * **Offset values** (decision 7) are already on the viewer's wall clock: the
 * model's `dateRange` moved them there, so nothing here knows about zones
 * except `dstNote`. `writtenAs` (`calendar-model.ts`) still says what was
 * written.
 */
import { DAY_MS } from '../time';
import { isClockPrecision, type CivilSpan } from '../objects/date-precision';
import { packLanes } from '../objects/interval-lanes';
import { dayStart, layoutMonth, rangeMeets, type CalendarItem, type GridWeek, type RowLayout } from '../objects/calendar-grid';

/** How long an event with no drawable end is drawn, in minutes. */
export const DEFAULT_TIMED_MINUTES = 30;
/** The least a timed piece occupies when packing, in minutes. */
export const MIN_TIMED_MINUTES = 15;

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

/** What the time grid reads of an event (a `TimelineEvent` is one). */
export interface TimeGridEvent {
  /** The note path — unique, the final tie-break. */
  key: string;
  title: string;
  /** Civil ms, [start, end). */
  start: number;
  end: number;
  startSpan: CivilSpan;
  endSpan: CivilSpan | null;
}

export type TimeGridPlacement = 'allDay' | 'timed';

/** Does the event have an end the hour grid can draw — a clock time? */
export function hasClockEnd(ev: Pick<TimeGridEvent, 'endSpan'>): boolean {
  return ev.endSpan !== null && isClockPrecision(ev.endSpan.precision);
}

/** Where a grid event goes on a week or day page (see the header). */
export function timeGridPlacement(ev: TimeGridEvent): TimeGridPlacement {
  if (!isClockPrecision(ev.startSpan.precision)) return 'allDay';
  if (ev.endSpan === null) return 'timed';
  if (hasClockEnd(ev)) return ev.end - ev.start >= DAY_MS ? 'allDay' : 'timed';
  return dayStart(ev.endSpan.start) > dayStart(ev.start) ? 'allDay' : 'timed';
}

/** The stretch the hour grid draws for a timed event: its own, or the
 *  default length, not past the start's midnight. */
export function drawnRange(ev: TimeGridEvent): { start: number; end: number; endKnown: boolean } {
  if (hasClockEnd(ev)) return { start: ev.start, end: ev.end, endKnown: true };
  const end = Math.min(ev.start + DEFAULT_TIMED_MINUTES * MINUTE_MS, dayStart(ev.start) + DAY_MS);
  return { start: ev.start, end: Math.max(end, ev.start + MINUTE_MS), endKnown: false };
}

// ── The hour grid ────────────────────────────────────────────────────────

/** One day's stretch of a timed event. */
export interface TimedPiece {
  key: string;
  /** The page column, 0–6 (0 on a day page). */
  col: number;
  /** Minutes past the day's midnight: [startMin, endMin), endMin ≤ 1440. */
  startMin: number;
  endMin: number;
  /** Cut at this day's midnight: the event began on an earlier day. */
  continuesBefore: boolean;
  /** Cut at the next midnight: it goes on into a later day. */
  continuesAfter: boolean;
  /** False when the end was invented (`DEFAULT_TIMED_MINUTES`): hatch it. */
  endKnown: boolean;
  /** Side-by-side position within its cluster, and the cluster's width in lanes. */
  lane: number;
  lanes: number;
}

/** A piece before packing: its day, minutes, and title for the tie-break. */
export type UnpackedPiece = Omit<TimedPiece, 'lane' | 'lanes'> & { title: string };

/** A timed event cut into one piece per page day it meets. */
function piecesOf(ev: TimeGridEvent, page: GridWeek): UnpackedPiece[] {
  const drawn = drawnRange(ev);
  const out: UnpackedPiece[] = [];
  page.days.forEach((day, col) => {
    const from = Math.max(drawn.start, day.start);
    const to = Math.min(drawn.end, day.start + DAY_MS);
    if (from >= to) return;
    out.push({
      key: ev.key,
      title: ev.title,
      col,
      startMin: (from - day.start) / MINUTE_MS,
      endMin: (to - day.start) / MINUTE_MS,
      continuesBefore: from > drawn.start,
      continuesAfter: to < drawn.end,
      endKnown: drawn.endKnown,
    });
  });
  return out;
}

/**
 * One day's pieces, side by side where they overlap (see the header). In
 * packing order: start, then end, then title, then key.
 */
export function layoutDay(pieces: readonly UnpackedPiece[], minMinutes = MIN_TIMED_MINUTES): TimedPiece[] {
  const packing = packLanes(
    pieces.map((p) => ({ key: p.key, start: p.startMin, end: p.endMin, title: p.title })),
    { minExtent: minMinutes },
  );
  const byKey = new Map(pieces.map((p) => [p.key, p] as const));
  const ordered = packing.order.map((key) => byKey.get(key)!);
  const out: TimedPiece[] = [];
  let cluster: TimedPiece[] = [];
  let clusterEnd = -Infinity;
  const close = (): void => {
    const lanes = cluster.reduce((n, p) => Math.max(n, p.lane + 1), 0);
    for (const p of cluster) p.lanes = lanes;
    cluster = [];
  };
  for (const raw of ordered) {
    if (raw.startMin >= clusterEnd) close();
    const piece: TimedPiece = {
      key: raw.key, col: raw.col, startMin: raw.startMin, endMin: raw.endMin,
      continuesBefore: raw.continuesBefore, continuesAfter: raw.continuesAfter, endKnown: raw.endKnown,
      lane: packing.lanes.get(raw.key)!, lanes: 1,
    };
    cluster.push(piece);
    out.push(piece);
    clusterEnd = Math.max(clusterEnd, raw.endMin, raw.startMin + minMinutes);
  }
  close();
  return out;
}

// ── The page ─────────────────────────────────────────────────────────────

export interface TimeGridLayout {
  /** The strip: day starts and long timed ones, as one month-grid row. */
  allDay: RowLayout;
  /** Per page column, its timed pieces in packing order. */
  timed: TimedPiece[][];
}

/** A week or day page of grid events (`CalendarModel.grid`). */
export function layoutTimeGrid(
  events: readonly TimeGridEvent[],
  page: GridWeek,
  opts: { minMinutes?: number } = {},
): TimeGridLayout {
  const strip: CalendarItem[] = [];
  const perDay: UnpackedPiece[][] = page.days.map(() => []);
  for (const ev of events) {
    if (timeGridPlacement(ev) === 'allDay') {
      if (rangeMeets(ev, page.start, page.end)) strip.push({ key: ev.key, title: ev.title, range: ev });
      continue;
    }
    for (const piece of piecesOf(ev, page)) perDay[piece.col]!.push(piece);
  }
  return {
    allDay: layoutMonth(strip, [page])[0]!,
    timed: perDay.map((pieces) => layoutDay(pieces, opts.minMinutes)),
  };
}

// ── DST ──────────────────────────────────────────────────────────────────

/** A day whose wall clock skips or repeats a stretch, in minutes past midnight. */
export interface DstNote {
  /** `skipped`: [atMin, atMin + minutes) never happened (spring forward).
   *  `repeated`: it happened twice (fall back). */
  kind: 'skipped' | 'repeated';
  atMin: number;
  minutes: number;
}

const localZoneOffset = (instantMs: number): number => -new Date(instantMs).getTimezoneOffset();

/**
 * The DST change on the civil day `dayMs` in the viewer's zone, or null when
 * its offset holds all day. `zoneOffsetMinutes` is `SpanOptions`'s: minutes
 * east of UTC at an instant, the runtime's local zone by default.
 */
export function dstNote(
  dayMs: number,
  zoneOffsetMinutes: (instantMs: number) => number = localZoneOffset,
): DstNote | null {
  const day = dayStart(dayMs);
  // The instants of this midnight and the next, each read in its own offset.
  const at = (wall: number): number => wall - zoneOffsetMinutes(wall - zoneOffsetMinutes(wall) * MINUTE_MS) * MINUTE_MS;
  let lo = at(day);
  let hi = at(day + DAY_MS);
  const before = zoneOffsetMinutes(lo);
  const after = zoneOffsetMinutes(hi);
  if (before === after) return null;
  // The first minute in the new offset.
  while (hi - lo > MINUTE_MS) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
    if (zoneOffsetMinutes(mid) === before) lo = mid;
    else hi = mid;
  }
  const delta = after - before;
  const wallMin = (offset: number): number => Math.round((hi + offset * MINUTE_MS - day) / MINUTE_MS);
  return delta > 0
    ? { kind: 'skipped', atMin: clampMin(wallMin(before)), minutes: delta }
    : { kind: 'repeated', atMin: clampMin(wallMin(after)), minutes: -delta };
}

function clampMin(m: number): number {
  return Math.min(DAY_MINUTES, Math.max(0, m));
}
