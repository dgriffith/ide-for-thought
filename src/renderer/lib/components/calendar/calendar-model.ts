/**
 * The Calendar's events (#2702), read once per data revision, and what one
 * month page shows of them. Pure, so it tests without a DOM; the grid maths
 * (`monthWeeks`, `layoutMonth`, `overflowRow`) is `shared/objects/calendar-grid.ts`'s.
 *
 * - **One read, the Timeline's.** Each instance's start and end are read by
 *   `buildTimelineModel` (`timeline-events.ts`), with the same *Date by* and
 *   end rule (`timelineProperties`), so the two layouts can't disagree about
 *   what a value means: a span at its precision, an offset value moved onto
 *   the viewer's wall clock and so onto the viewer's local day (decision 7),
 *   a backwards or unreadable `end` set aside and flagged, an unreadable or
 *   missing start in the Undated tray with a reason.
 * - **Placement by the start's precision** (`placementOf`, decision 3): a day
 *   or clock start is in the cells; a month start in the month band and a
 *   year start in the year band, on every page their range meets, marked
 *   "since …" / "until …" where the range runs past the page.
 * - **A day's list** (`dayEvents`, the "+N more" popover and Enter on a day):
 *   every grid event covering that day, in the grid's stacking order (first
 *   day, then start time, then title), so it reads like the cell above it.
 */
import { buildTimelineModel, type TimelineEvent, type TimelineProperties, type UndatedEvent } from '../timeline/timeline-events';
import {
  coveredDays, dayStart, monthBounds, placementOf, rangeMeets,
  type CalendarItem, type CalendarMonth, type GridWeek,
} from '../../../../shared/objects/calendar-grid';
import { civilMs, isClockPrecision, parseDateValue } from '../../../../shared/objects/date-precision';

export interface CalendarModel {
  /** Day or clock starts: drawn in the cells. */
  grid: TimelineEvent[];
  /** Month-precision starts (`1969-07`). */
  month: TimelineEvent[];
  /** Year-precision starts (`1969`). */
  year: TimelineEvent[];
  undated: UndatedEvent[];
  byKey: Map<string, TimelineEvent>;
}

/** Read every instance once (see the header). `locale` is the viewer's in the app. */
export function buildCalendarModel(
  instances: Parameters<typeof buildTimelineModel>[0],
  opts: TimelineProperties & { locale?: string },
): CalendarModel {
  const t = buildTimelineModel(instances, opts);
  const out: CalendarModel = { grid: [], month: [], year: [], undated: [], byKey: new Map() };
  for (const ev of t.dated) {
    out[placementOf(ev)].push(ev);
    out.byKey.set(ev.key, ev);
  }
  // The read is the Timeline's, but the words are the calendar's.
  out.undated = t.undated.map((u) => (u.reason === 'out-of-range' ? { ...u, reasonText: u.reasonText.replace("the timeline's", "the calendar's") } : u));
  return out;
}

/** The grid events that meet the page's rows, as `layoutMonth` takes them. */
export function pageItems(grid: readonly TimelineEvent[], weeks: readonly GridWeek[]): CalendarItem[] {
  if (weeks.length === 0) return [];
  const start = weeks[0]!.start;
  const end = weeks[weeks.length - 1]!.end;
  return grid.filter((ev) => rangeMeets(ev, start, end)).map((ev) => ({ key: ev.key, title: ev.title, range: ev }));
}

/** Every grid event covering the civil day `day`, in the cell's order. */
export function dayEvents(grid: readonly TimelineEvent[], day: number): TimelineEvent[] {
  const d = dayStart(day);
  return grid
    .filter((ev) => { const { first, last } = coveredDays(ev); return first <= d && last >= d; })
    .sort((a, b) => {
      const fa = dayStart(a.start);
      const fb = dayStart(b.start);
      if (fa !== fb) return fa - fb; // a bar that began earlier stacks first
      const la = coveredDays(a).last;
      const lb = coveredDays(b).last;
      if (la !== lb) return lb - la; // then the longer one, as `layoutMonth` packs it
      return a.start - b.start || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
    });
}

// ── Bands ────────────────────────────────────────────────────────────────

export interface BandEntry {
  ev: TimelineEvent;
  /** "since July", "since 1960" — the range began before the page; else null. */
  since: string | null;
  /** "until September", "until 1969" — it runs past the page; else null. */
  until: string | null;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: string | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** Civil ms → its year and month. */
function ym(ms: number): CalendarMonth {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** A month's name, with its year when it isn't the page's: "July", "December 2025". */
function monthName(ms: number, pageYear: number, locale: string | undefined): string {
  const at = new Date(ms);
  const opts: Intl.DateTimeFormatOptions = at.getUTCFullYear() === pageYear ? { month: 'long' } : { month: 'long', year: 'numeric' };
  if (at.getUTCFullYear() <= 0 && opts.year) opts.era = 'short';
  return fmt(locale, opts).format(at);
}

/** A year as text, "1969" or "44 BC" (an era at or before 1 BCE, as `formatDateValue` does). */
export function yearName(year: number, locale?: string): string {
  const at = new Date(civilMs(year, 0, 1));
  return fmt(locale, year <= 0 ? { year: 'numeric', era: 'short' } : { year: 'numeric' }).format(at);
}

/** The month and year bands of one page: partial-date events whose range meets it. */
export function pageBands(model: Pick<CalendarModel, 'month' | 'year'>, page: CalendarMonth, locale?: string): { month: BandEntry[]; year: BandEntry[] } {
  const { start, end } = monthBounds(page);
  const pageKey = page.year * 12 + page.month;
  const month = model.month.filter((ev) => rangeMeets(ev, start, end)).map((ev) => {
    const first = ym(ev.start);
    const last = ym(coveredDays(ev).last);
    return {
      ev,
      since: first.year * 12 + first.month < pageKey ? `since ${monthName(ev.start, page.year, locale)}` : null,
      until: last.year * 12 + last.month > pageKey ? `until ${monthName(coveredDays(ev).last, page.year, locale)}` : null,
    };
  });
  const year = model.year.filter((ev) => rangeMeets(ev, start, end)).map((ev) => {
    const first = ym(ev.start).year;
    const last = ym(coveredDays(ev).last).year;
    return {
      ev,
      since: first < page.year ? `since ${yearName(first, locale)}` : null,
      until: last > page.year ? `until ${yearName(last, locale)}` : null,
    };
  });
  const order = (a: BandEntry, b: BandEntry) => a.ev.start - b.ev.start || a.ev.title.localeCompare(b.ev.title);
  return { month: month.sort(order), year: year.sort(order) };
}

// ── Text ─────────────────────────────────────────────────────────────────

/** "October 2026", "March 44 BC". */
export function monthTitle(page: CalendarMonth, locale?: string): string {
  const at = new Date(civilMs(page.year, page.month - 1, 1));
  return fmt(locale, page.year <= 0 ? { month: 'long', year: 'numeric', era: 'short' } : { month: 'long', year: 'numeric' }).format(at);
}

/** "Tuesday, 6 October 2026" (en-GB) — a day cell's name, before its event count. */
export function dayName(day: number, locale?: string): string {
  const at = new Date(day);
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  if (at.getUTCFullYear() <= 0) opts.era = 'short';
  return fmt(locale, opts).format(at);
}

/** A weekday's long and short names, for the column headers; 1 = Monday … 7 = Sunday. */
export function weekdayNames(weekday: number, locale?: string): { long: string; short: string } {
  const at = new Date(civilMs(2024, 0, weekday)); // 1 January 2024 was a Monday
  return { long: fmt(locale, { weekday: 'long' }).format(at), short: fmt(locale, { weekday: 'short' }).format(at) };
}

/** The local time a clock-precision start shows ("9:00 AM"), else null — a
 *  day start has no time. The civil axis already holds the viewer's wall
 *  clock, so this is formatted in UTC. */
export function timeOf(ev: Pick<TimelineEvent, 'start' | 'startSpan'>, locale?: string): string | null {
  return isClockPrecision(ev.startSpan.precision) ? fmt(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(ev.start)) : null;
}

/**
 * Decision 7: an offset value shows on the viewer's own day; when that isn't
 * the day it was written on, the hover card says what was written. Null when
 * the days agree, or the value is floating or has no time.
 */
export function writtenAs(ev: Pick<TimelineEvent, 'start'>, raw: string | null | undefined): string | null {
  const p = parseDateValue(raw);
  if (!p || p.offsetMinutes === null || p.month === undefined || p.day === undefined) return null;
  return civilMs(p.year, p.month - 1, p.day) === dayStart(ev.start) ? null : `Written as ${raw!.trim()}`;
}
