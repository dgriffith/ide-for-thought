/**
 * Compact relative-time stamp for sidebar file rows ("2h", "5d", "1mo").
 *
 * Brevity over precision — the row is 24px tall and the stamp shares it
 * with the file name, so we collapse to a single unit. Anything under a
 * minute is "now"; anything over a year is "Yy".
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatRelativeTime(mtimeMs: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - mtimeMs);
  if (delta < MIN) return 'now';
  if (delta < HOUR) return `${Math.floor(delta / MIN)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d`;
  if (delta < MONTH) return `${Math.floor(delta / WEEK)}w`;
  if (delta < YEAR) return `${Math.floor(delta / MONTH)}mo`;
  return `${Math.floor(delta / YEAR)}y`;
}
