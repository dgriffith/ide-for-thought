/**
 * Which weekday a calendar's rows start on (#2702), as the Calendar design
 * story decided (`docs/vision/objects-expansion.md`, Calendar "Decision 3";
 * confirmed on #2699 as decision 4). Pure: the settings store reads the
 * per-machine choice and the system locale, and hands both here.
 *
 * - **Automatic** is the system locale's REGION's first day:
 *   `Intl.Locale.prototype.getWeekInfo().firstDay` of `app.getSystemLocale()`
 *   (an English speaker in Germany is `en-DE`, whose week starts on Monday).
 *   The renderer's own `navigator.language` carries no region, so it is only
 *   the fallback while main's answer is on its way, and Monday (ISO 8601) is
 *   the fallback when `getWeekInfo` is missing or the tag is unreadable. The
 *   getter `weekInfo` does not exist in Electron's Chromium; only the method.
 * - **Monday / Sunday / Saturday** override it: the three first days CLDR
 *   uses. The setting exists because macOS's own "First day of week"
 *   preference can't be read.
 *
 * Weekdays are `calendar-grid.ts`'s `Weekday`: 1 = Monday … 7 = Sunday.
 */
import type { Weekday } from './calendar-grid';

export type WeekStartSetting = 'auto' | 'monday' | 'sunday' | 'saturday';

export const WEEK_START_SETTINGS: readonly WeekStartSetting[] = ['auto', 'monday', 'sunday', 'saturday'];

const FIXED: Record<Exclude<WeekStartSetting, 'auto'>, Weekday> = { monday: 1, sunday: 7, saturday: 6 };

/** Monday, ISO 8601's week start — the fallback when a locale can't say. */
export const ISO_WEEK_START: Weekday = 1;

/** A stored setting from untrusted text: one of the four, else Automatic. */
export function parseWeekStartSetting(raw: unknown): WeekStartSetting {
  return typeof raw === 'string' && (WEEK_START_SETTINGS as readonly string[]).includes(raw) ? (raw as WeekStartSetting) : 'auto';
}

/** `getWeekInfo().firstDay` of a BCP 47 tag (or a POSIX one, `en_GB`), else
 *  null when the runtime or the tag can't say. Never throws. */
export function weekStartForLocale(tag: string | null | undefined): Weekday | null {
  if (!tag) return null;
  try {
    const loc = new Intl.Locale(tag.replace(/_/g, '-')) as Intl.Locale & { getWeekInfo?: () => { firstDay?: number } };
    const first = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo().firstDay : undefined;
    return typeof first === 'number' && Number.isInteger(first) && first >= 1 && first <= 7 ? (first as Weekday) : null;
  } catch (err) {
    // `new Intl.Locale` throws a RangeError on a malformed tag: "can't say".
    if (err instanceof RangeError) return null;
    throw err;
  }
}

/**
 * The weekday rows start on. `locales` are tried in order for Automatic —
 * the system locale first, then the renderer's language — and the first that
 * answers wins; none answering is Monday.
 */
export function resolveWeekStart(setting: WeekStartSetting, locales: readonly (string | null | undefined)[]): Weekday {
  if (setting !== 'auto') return FIXED[setting];
  for (const tag of locales) {
    const day = weekStartForLocale(tag);
    if (day !== null) return day;
  }
  return ISO_WEEK_START;
}
