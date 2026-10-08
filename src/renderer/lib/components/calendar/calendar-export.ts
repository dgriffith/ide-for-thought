/**
 * What an exported Calendar month draws (#2704, epic #2699). Pure.
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
import type { TimelineEvent } from '../timeline/timeline-events';
import {
  coveredDays, layoutMonth, monthWeeks, uncertainFrom,
  type CalendarMonth, type GridWeek, type PlacedSegment, type Weekday,
} from '../../../../shared/objects/calendar-grid';
import { DAY_MS } from '../../../../shared/time';
import { pageItems } from './calendar-model';

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
