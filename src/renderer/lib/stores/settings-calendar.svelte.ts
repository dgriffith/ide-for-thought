/**
 * The Calendar's two per-machine settings (#2702), Settings → Appearance:
 *
 * - **Week starts on**: Automatic (the system locale's region), Monday,
 *   Sunday or Saturday (`shared/objects/week-start.ts`).
 * - **Show week numbers**: ISO 8601 week numbers on each row, off by default.
 *
 * Per machine, like the other appearance settings, and never per view or per
 * thoughtbase: a shared thoughtbase must not change its reader's week. So
 * they live in `localStorage` (the renderer's per-`userData` store), the
 * shape `graph-settings.svelte.ts` uses, as `$state` so an open calendar
 * re-lays its rows the moment the setting changes.
 *
 * Automatic needs the OS locale's region, which only main can read
 * (`app.getSystemLocale()`; `navigator.language` has none). It's asked once,
 * on first use; until it answers, and if it can't, `navigator.language`
 * decides, then Monday.
 */
import { api } from '../ipc/client';
import { parseWeekStartSetting, resolveWeekStart, type WeekStartSetting } from '../../../shared/objects/week-start';
import type { Weekday } from '../../../shared/objects/calendar-grid';
import { logger } from '../../../shared/logger';

const WEEK_START_KEY = 'minerva.calendar.weekStart';
const WEEK_NUMBERS_KEY = 'minerva.calendar.weekNumbers';
const log = logger('settings');

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    // A private window or blocked site data: the setting reads as its default.
    log.debug('calendar settings: localStorage unreadable', err);
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    log.warn('calendar settings: could not save', key, err);
  }
}

let weekStartSetting = $state<WeekStartSetting>(parseWeekStartSetting(read(WEEK_START_KEY)));
let showWeekNumbers = $state<boolean>(read(WEEK_NUMBERS_KEY) === 'true');
let systemLocale = $state<string | null>(null);
let asked = false;

function askSystemLocale(): void {
  if (asked) return;
  asked = true;
  // Through a promise, so even a missing bridge is a logged fallback, never a render error.
  void Promise.resolve().then(() => api.app.getSystemLocale()).then(
    (tag) => { systemLocale = tag || null; },
    (err: unknown) => log.warn('calendar settings: no system locale, using the app language', err),
  );
}

function rendererLanguage(): string | null {
  return typeof navigator !== 'undefined' ? navigator.language || null : null;
}

export function getCalendarSettings() {
  return {
    /** The stored choice. */
    get weekStartSetting(): WeekStartSetting { return weekStartSetting; },
    /** The weekday rows start on, 1 = Monday … 7 = Sunday. */
    get weekStart(): Weekday {
      if (weekStartSetting === 'auto') askSystemLocale();
      return resolveWeekStart(weekStartSetting, [systemLocale, rendererLanguage()]);
    },
    /** What Automatic resolves to here — for the setting's own label. */
    get automaticWeekStart(): Weekday {
      askSystemLocale();
      return resolveWeekStart('auto', [systemLocale, rendererLanguage()]);
    },
    get showWeekNumbers(): boolean { return showWeekNumbers; },
    setWeekStart(next: WeekStartSetting): void {
      weekStartSetting = parseWeekStartSetting(next);
      write(WEEK_START_KEY, weekStartSetting);
    },
    setShowWeekNumbers(next: boolean): void {
      showWeekNumbers = next;
      write(WEEK_NUMBERS_KEY, String(next));
    },
  };
}

/** Test-only: re-read from localStorage and forget the system locale. */
export function __resetCalendarSettingsForTests(): void {
  weekStartSetting = parseWeekStartSetting(read(WEEK_START_KEY));
  showWeekNumbers = read(WEEK_NUMBERS_KEY) === 'true';
  systemLocale = null;
  asked = false;
}
