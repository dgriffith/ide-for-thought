/**
 * Shared steps for the Calendar specs (#2702, #2703, #2705): open a dated
 * type's view on its Calendar tab, find a day cell and an event in the grid,
 * say which month the grid shows, and reschedule an event — by dragging it
 * onto a day with the pointer, or from the keyboard through the day's list
 * and *Move to date…*.
 *
 * A day cell is found by `data-day` (its civil-axis ms, `date-precision.ts`),
 * an event by its accessible name, which starts with its title. Specs build
 * their dates around the CURRENT month (`thisMonth`), because a view with no
 * stored `month` opens on it.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** The current month, as the renderer judges it: local year and 1–12. */
export function thisMonth(now = new Date()): { year: number; month: number } {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** The month `n` months after `m` (before, for a negative `n`). */
export function addMonth(m: { year: number; month: number }, n: number): { year: number; month: number } {
  const i = m.year * 12 + (m.month - 1) + n;
  return { year: Math.floor(i / 12), month: (((i % 12) + 12) % 12) + 1 };
}

/** `2026-10`, `2026-10-05`: a month, or a day in it. */
export function ymd(m: { year: number; month: number }, day?: number): string {
  const base = `${m.year}-${String(m.month).padStart(2, '0')}`;
  return day === undefined ? base : `${base}-${String(day).padStart(2, '0')}`;
}

/** The civil-axis ms of a day: what a cell's `data-day` holds. */
export function civilDay(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

export interface Calendar {
  grid: Locator;
  /** The month heading the grid is labelled by ("October 2026"). */
  title: Locator;
  /** The day cell for a date. */
  day(year: number, month: number, day: number): Locator;
  /** Every drawn segment of an event, by its title. */
  eventFor(title: string): Locator;
  /** The roving tab stop. */
  tabStop: Locator;
  /** The day's list ("+N more" / Enter). */
  dayList: Locator;
}

export function calendarOf(win: Page): Calendar {
  const grid = win.locator('.cal-grid[role="grid"]');
  return {
    grid,
    title: win.locator('.cal-title'),
    day: (y, m, d) => grid.locator(`[role="gridcell"][data-day="${civilDay(y, m, d)}"]`),
    eventFor: (title) => grid.locator(`[data-calendar-event][aria-label^="${title},"]`),
    tabStop: grid.locator('[role="gridcell"][tabindex="0"]'),
    dayList: win.getByRole('dialog').and(win.locator('[data-calendar-day-list]')),
  };
}

/** The `YYYY-MM` the grid shows. */
export async function shownMonth(win: Page): Promise<string> {
  return (await calendarOf(win).grid.getAttribute('data-month')) ?? '';
}

/** From the Objects panel, open a type's view (by its label) on its Calendar tab. */
export async function openTypeCalendar(win: Page, label: string): Promise<Calendar> {
  await win.locator('.panel-tab[title="Objects"]').first().click();
  await win.getByRole('button', { name: `Open ${label} view` }).click({ force: true });
  await win.getByRole('tab', { name: 'Calendar' }).click();
  await expect(win.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true');
  const c = calendarOf(win);
  await expect(c.grid).toBeVisible({ timeout: 15_000 });
  return c;
}

/**
 * Drag the event titled `title` onto a day of month `m` with the pointer.
 * The press lands 12px into the event's FIRST segment, which is inside its
 * first day, so that day is the grab day and the event moves by
 * `day − its first day` (#2703). The move is stepped: a drag starts after 5px
 * of travel (`event-drag.ts`, pointer events, not HTML5 drag-and-drop).
 * `whileOver` runs with the pointer held over the day, before the drop — for
 * asserting the drop preview or its absence.
 */
export async function dragEventToDay(
  win: Page,
  cal: Calendar,
  title: string,
  m: { year: number; month: number },
  day: number,
  whileOver?: () => Promise<void>,
): Promise<void> {
  const from = await cal.eventFor(title).first().boundingBox();
  const to = await cal.day(m.year, m.month, day).boundingBox();
  if (!from || !to) throw new Error(`no layout for the ${title} event or day ${day}`);
  await win.mouse.move(from.x + 12, from.y + from.height / 2);
  await win.mouse.down();
  await win.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await whileOver?.();
  await win.mouse.up();
}

/**
 * Keyboard only, put the grid into "choose a day" mode for one event: focus
 * its day, Enter for the day's list (focus lands on the event, the day's only
 * one), Shift+F10 for its menu, Enter on *Move to date…*. Focus is then back
 * on the event's day; the arrows move it, Enter moves the event there, and
 * the move bar's text field takes a typed date (#2703).
 *
 * `noteFile` is the end of the event's note path (`Standup.md`).
 */
export async function startMoveToDate(
  win: Page,
  cal: Calendar,
  m: { year: number; month: number },
  day: number,
  noteFile: string,
): Promise<void> {
  await cal.day(m.year, m.month, day).focus();
  await win.keyboard.press('Enter');
  await expect(cal.dayList).toBeVisible();
  await expect(cal.dayList.locator(`[data-day-event][data-note-path$="${noteFile}"]`)).toBeFocused();
  await win.keyboard.press('Shift+F10');
  await expect(win.getByRole('menuitem', { name: 'Move to date…' })).toBeFocused();
  await win.keyboard.press('Enter');
  await expect(cal.day(m.year, m.month, day)).toBeFocused();
}
