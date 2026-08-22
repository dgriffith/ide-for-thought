/**
 * Absolute date+time stamps, shared by main and the renderer so a timestamp
 * written into text (a restore's cause line) reads identically to the same
 * moment rendered in the History panel.
 *
 * Distinct from `renderer/lib/utils/format-relative-time`, which collapses to a
 * single unit ("2h", "5d") because it shares a 24px file row. A revision
 * timeline is the opposite case: "now" and "1m" are useless for telling two
 * versions apart, so we always show the date and the time to the minute.
 */

/** Time to the minute, locale-aware (12h/24h follows the user's locale). */
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
const DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

/**
 * e.g. `Aug 22, 2:07 PM` — with the year added when the timestamp is from
 * another year, since "Aug 22" alone would be a lie about which one.
 */
export function formatDateTime(ts: number, now: number = Date.now()): string {
  const when = new Date(ts);
  const sameYear = when.getFullYear() === new Date(now).getFullYear();
  return when.toLocaleString(undefined, {
    ...DATE,
    ...(sameYear ? {} : { year: 'numeric' }),
    ...TIME,
  });
}
