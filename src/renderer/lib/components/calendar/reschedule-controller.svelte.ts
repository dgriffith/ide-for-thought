/**
 * The Calendar's reschedule state (#2703): what a drag drop and *Move to
 * date…* do, one per calendar. `TypeViewCalendar` wires it to the grid; the
 * write is the `kanban-moves` store's `rescheduleEvent`, so this only decides
 * the day count and the words.
 *
 * - **A drop** moves the event by the days the drag gave (drop day − grab
 *   day).
 * - ***Move to date…*** puts the grid in "choose a day" mode (`moving`):
 *   focus goes to the event's start day, the grid's keys move as always,
 *   and `confirm(day)` (Enter, a click on a day, or a typed date) moves it by
 *   `day − startDayOf(start)`. `cancel` (Escape, or focus leaving the
 *   calendar) moves nothing.
 * - **A refused event** (a start or end that is only a month or year) never
 *   enters the mode: the refusal is spoken instead.
 * - **⌘Z** (`onKeydown`) undoes the calendar's last move, never a board's.
 */
import { addDays } from '../../../../shared/objects/calendar-grid';
import { DAY_MS } from '../../../../shared/time';
import { getKanbanMoveStore } from '../../stores/kanban-moves.svelte';
import { announce } from '../../stores/announcer.svelte';
import { cardMoveKey } from '../kanban/card-drag';
import { dayName, type CalendarModel } from './calendar-model';
import { eventStartDay, refusalFor } from './reschedule';
import type { TimelineProperties } from '../timeline/timeline-events';

export interface RescheduleHost {
  model: () => CalendarModel;
  dates: () => TimelineProperties;
  locale: () => string | undefined;
  /** False read-only or in an export: nothing moves. */
  interactive: () => boolean;
  /** Focus a day cell, turning the page when it's on another month. */
  focusDay: (day: number) => void;
  /** Close the day's list (focus is about to move to the grid). */
  closeList: () => void;
}

export function createReschedule(host: RescheduleHost) {
  const moves = getKanbanMoveStore();
  let moving = $state<{ key: string; title: string; from: number } | null>(null);

  function refusalOf(key: string): string | null {
    const ev = host.model().byKey.get(key);
    return ev ? refusalFor(ev, host.dates()) : null;
  }

  function move(key: string, days: number): void {
    const ev = host.model().byKey.get(key);
    const from = ev ? eventStartDay(ev, host.dates()) : null;
    if (!ev || from === null || !host.interactive()) return;
    const { dateProperty, endProperty } = host.dates();
    void moves.rescheduleEvent(
      { path: key, title: ev.title },
      { start: dateProperty, end: endProperty },
      days,
      { to: dayName(addDays(from, days), host.locale()), back: dayName(from, host.locale()) },
    );
  }

  function start(key: string): void {
    const ev = host.model().byKey.get(key);
    const refusal = refusalOf(key);
    if (refusal !== null) { announce(refusal); return; }
    const from = ev ? eventStartDay(ev, host.dates()) : null;
    if (!ev || from === null) return;
    host.closeList();
    moving = { key, title: ev.title, from };
    host.focusDay(from);
  }

  function cancel(refocus: boolean): void {
    const m = moving;
    if (!m) return;
    moving = null;
    announce(`Move of ${m.title} cancelled.`);
    if (refocus) host.focusDay(m.from);
  }

  function confirm(day: number): void {
    const m = moving;
    if (!m) return;
    moving = null;
    host.focusDay(day);
    if (day === m.from) announce(`${m.title} is already on ${dayName(day, host.locale())}.`);
    else move(m.key, Math.round((day - m.from) / DAY_MS));
  }

  /** On the calendar's root: ⌘Z undoes the calendar's last move (a text field keeps its own undo). */
  function onKeydown(e: KeyboardEvent): void {
    if (!host.interactive() || cardMoveKey(e) !== 'undo') return;
    if ((e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    void moves.undoLastMove('calendar');
  }

  /** On the calendar's root: choosing a day ends when focus leaves the calendar
   *  (not on a window switch, or while a page turn redraws the cells). */
  function onFocusout(e: FocusEvent): void {
    const to = e.relatedTarget as Node | null;
    if (moving && to && !(e.currentTarget as HTMLElement).contains(to)) cancel(false);
  }

  return {
    /** The event being moved while the grid chooses a day, or null. */
    get moving() { return moving; },
    refusalOf,
    move,
    start,
    cancel,
    confirm,
    onKeydown,
    onFocusout,
  };
}
