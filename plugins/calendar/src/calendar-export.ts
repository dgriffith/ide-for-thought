/**
 * What an exported Calendar month draws (#2704, epic #2699) — and, for a
 * week or a day, the agenda it draws instead (#2955, `planAgendaExport`,
 * below). Pure.
 *
 * A page can't open "+N more", so an export lists **every event in its
 * day's cell** (decision 9 on #2699): a busy day makes a tall row, which is
 * acceptable in print, and a separate list after the grid would repeat
 * every event. To make that readable, the live grid's one-slot-per-event
 * layout is split in two:
 *
 * - **Multi-day events are bars**, laid out by `layoutMonth` over the
 *   multi-day events alone, so a bar keeps one slot across its row and is
 *   cut at each row as in the app. A bar is one line (its title can be cut
 *   short where a continuation is a single day wide; its first segment is
 *   at least two days wide or, for a one-day first segment, continues).
 * - **Single-day events flow** under the row's bars, one per line, wrapping
 *   — so a long title is printed whole instead of ellipsised, which is the
 *   live view's answer only because it has a hover card.
 *
 * Both are in `dayEvents`' order (an earlier-starting, then longer, event
 * first; then start time and title), so a day reads the way the live cell
 * and its day list do: a bar always began no later than a single-day event
 * on the same day, and is longer.
 */
import type { TimelineEvent } from '../../../src/shared/timeline/timeline-events';
import {
  coveredDays, layoutMonth, monthWeeks, rangeMeets, uncertainFrom,
  type CalendarMonth, type GridWeek, type PlacedSegment, type Weekday,
} from '../../../src/shared/objects/calendar-grid';
import { DAY_MS } from '../../../src/shared/time';
import { pageItems } from '../../../src/shared/calendar/calendar-model';
import { drawnRange, timeGridPlacement } from '../../../src/shared/calendar/time-grid';

export interface ExportRow {
  week: GridWeek;
  /** Multi-day segments, each with a slot shared across its row. */
  bars: PlacedSegment[];
  /** Slots the row's bars take (0 when it has none). */
  barSlots: number;
  /** Per column 0–6: the single-day events on that day, in order. */
  singles: TimelineEvent[][];
  /** Per column 0–6: how many events cover the day (bars and singles). */
  counts: number[];
}

export interface CalendarExportPlan {
  weeks: GridWeek[];
  rows: ExportRow[];
  /** Any drawn event is hatched (an end coarser than its start) — the legend. */
  hatched: boolean;
}

const isMultiDay = (ev: Pick<TimelineEvent, 'start' | 'end'>): boolean => {
  const { first, last } = coveredDays(ev);
  return last > first;
};

/** A single-day event drawn hatched: its end is a month or year, so even its one day is approximate. */
export const singleIsApprox = (ev: Pick<TimelineEvent, 'endSpan'>): boolean => uncertainFrom(ev) !== null;

export function planCalendarExport(grid: readonly TimelineEvent[], page: CalendarMonth, weekStart: Weekday): CalendarExportPlan {
  const weeks = monthWeeks(page, weekStart);
  if (weeks.length === 0) throw new Error(`no weeks for ${page.year}-${page.month}`);
  const items = pageItems(grid, weeks);
  const byKey = new Map(grid.map((ev) => [ev.key, ev] as const));
  const barRows = layoutMonth(items.filter((it) => isMultiDay(it.range)), weeks);

  const singles: TimelineEvent[][][] = weeks.map(() => Array.from({ length: 7 }, () => []));
  for (const it of items) {
    if (isMultiDay(it.range)) continue;
    const ev = byKey.get(it.key)!;
    const d = coveredDays(ev).first;
    const r = weeks.findIndex((w) => d >= w.start && d < w.end);
    if (r >= 0) singles[r]![(d - weeks[r]!.start) / DAY_MS]!.push(ev);
  }
  const order = (a: TimelineEvent, b: TimelineEvent) => a.start - b.start || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);

  let hatched = false;
  const rows = weeks.map((week, r) => {
    const bars = barRows[r]!.segments;
    const cells = singles[r]!.map((list) => list.sort(order));
    const counts = cells.map((list) => list.length);
    for (const s of bars) {
      if (s.uncertainFromCol !== null) hatched = true;
      for (let c = s.startCol; c < s.endCol; c++) counts[c]!++;
    }
    if (cells.some((list) => list.some(singleIsApprox))) hatched = true;
    return { week, bars, barSlots: barRows[r]!.slotCount, singles: cells, counts };
  });
  return { weeks, rows, hatched };
}

// ── A week or a day: an agenda (#2955) ───────────────────────────────────
//
// Decision (#2955): a week or day exports as an AGENDA, not an hour grid —
// on paper, overlapping events side by side and an hour grid broken across
// pages fight the drawing, and a printed hour grid is mostly empty boxes.
// Each day of the page lists the events that meet it: all-day ones first
// (a day start, or a timed stay of a day or more — `timeGridPlacement`'s
// strip), by start then title; then timed ones by their time on that day.
// An event that crosses midnight is listed on each day it meets, with what
// it shows there: "from 22:00" on the first, "until 02:00" on the next. An
// approximate one says so in words, so the agenda needs no legend.

const MINUTE_MS = 60_000;

/** One event on one agenda day. */
export interface AgendaEntry {
  ev: TimelineEvent;
  /** A timed event's stretch on this day, in minutes past its midnight; null for an all-day one. */
  fromMin: number | null;
  toMin: number | null;
  /** It began on an earlier day, or goes on into a later one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Its end wasn't written as a time: the time grid drew it half an hour; the agenda gives the start alone. */
  endKnown: boolean;
}

export interface AgendaDay {
  /** The day's start, civil ms. */
  day: number;
  allDay: AgendaEntry[];
  timed: AgendaEntry[];
}

export interface AgendaExportPlan {
  days: AgendaDay[];
}

/** The agenda for a week or day page (see above). */
export function planAgendaExport(grid: readonly TimelineEvent[], page: GridWeek): AgendaExportPlan {
  const byTitle = (a: AgendaEntry, b: AgendaEntry) => a.ev.title.localeCompare(b.ev.title) || a.ev.key.localeCompare(b.ev.key);
  const days = page.days.map((d): AgendaDay => {
    const dayEnd = d.start + DAY_MS;
    const allDay: AgendaEntry[] = [];
    const timed: AgendaEntry[] = [];
    for (const ev of grid) {
      if (timeGridPlacement(ev) === 'allDay') {
        if (!rangeMeets(ev, d.start, dayEnd)) continue;
        allDay.push({ ev, fromMin: null, toMin: null, continuesBefore: ev.start < d.start, continuesAfter: ev.end > dayEnd, endKnown: true });
      } else {
        const drawn = drawnRange(ev);
        if (!rangeMeets(drawn, d.start, dayEnd)) continue;
        const from = Math.max(drawn.start, d.start);
        const to = Math.min(drawn.end, dayEnd);
        timed.push({
          ev, fromMin: (from - d.start) / MINUTE_MS, toMin: (to - d.start) / MINUTE_MS,
          continuesBefore: drawn.start < d.start, continuesAfter: drawn.end > dayEnd, endKnown: drawn.endKnown,
        });
      }
    }
    allDay.sort((a, b) => a.ev.start - b.ev.start || byTitle(a, b));
    timed.sort((a, b) => a.fromMin! - b.fromMin! || a.toMin! - b.toMin! || byTitle(a, b));
    return { day: d.start, allDay, timed };
  });
  return { days };
}
