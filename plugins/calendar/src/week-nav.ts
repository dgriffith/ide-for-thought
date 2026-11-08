/**
 * The Week mode's page rules (#2951, epic #2949): which week a switch from
 * the month grid opens and which month a switch back opens, stepping, and the
 * week's title. Pure, so it tests without a DOM.
 *
 * **"Following today" carries across a switch.** A month page that is the
 * current month by default (its `month` unwritten) opens today's week with
 * `date` unwritten, and a week that follows today opens the current month
 * with `month` unwritten — so a view saved on "today" keeps following today
 * whichever mode it's in. An explicit page stays explicit.
 */
import {
  addDays, dayStart, formatDayAnchor, formatMonthAnchor, monthBounds, monthOf, timePage,
  type CalendarMonth, type GridWeek, type Weekday,
} from '../../../src/shared/objects/calendar-grid';
import { DAY_MS } from '../../../src/shared/time';

/** The day a month page opens its week on, and the `date` to write (null: today). */
export function weekFromMonth(opts: {
  page: CalendarMonth;
  /** The page follows today (`month` unwritten). */
  followsToday: boolean;
  /** The grid's focused day, if any. */
  focused: number | null;
  today: number;
  weekStart: Weekday;
}): { anchor: number; date: string | null } {
  const { start, end } = monthBounds(opts.page);
  const inPage = (d: number | null): d is number => d !== null && d >= start && d < end;
  const anchor = inPage(opts.focused) ? dayStart(opts.focused) : inPage(opts.today) ? opts.today : start;
  const sameWeek = timePage(anchor, 'week', opts.weekStart).start === timePage(opts.today, 'week', opts.weekStart).start;
  return { anchor, date: opts.followsToday && sameWeek ? null : formatDayAnchor(anchor) };
}

/** The `month` a week page opens on the month grid (null: the current month). */
export function monthFromWeek(opts: { anchor: number; followsToday: boolean }): string | null {
  return opts.followsToday ? null : formatMonthAnchor(monthOf(opts.anchor));
}

/** The same weekday `n` weeks on. */
export function stepWeek(anchor: number, n: number): number {
  return addDays(anchor, 7 * n);
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

/**
 * The week's title: "5 – 11 October 2026", "28 September – 4 October 2026",
 * "29 December 2025 – 4 January 2026" (the locale's own range format), with
 * "Week 41 · " ahead of it when week numbers show.
 */
export function weekTitle(page: GridWeek, locale?: string, weekNumber?: number | null): string {
  const first = new Date(page.start);
  const last = new Date(page.end - DAY_MS);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
  if (first.getUTCFullYear() <= 0) opts.era = 'short';
  const range = fmt(locale, opts).formatRange(first, last);
  return weekNumber ? `Week ${weekNumber} · ${range}` : range;
}

/** A time of day, `minutes` past midnight, in the viewer's locale: "9:00", "9 AM" style per locale. */
export function clockLabel(minutes: number, locale?: string): string {
  return fmt(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2000, 0, 1) + minutes * 60_000));
}

/** A time range within a day, the locale's way: "9:00 – 11:00 AM", "09:00–11:00". */
export function clockRange(fromMin: number, toMin: number, locale?: string): string {
  const base = Date.UTC(2000, 0, 1);
  // A range ending at midnight would format across two dates, with the dates: say midnight plainly.
  if (toMin >= 24 * 60) return `${clockLabel(fromMin, locale)} – ${clockLabel(0, locale)}`;
  return fmt(locale, { hour: 'numeric', minute: '2-digit' }).formatRange(new Date(base + fromMin * 60_000), new Date(base + toMin * 60_000));
}
