/**
 * The Calendar's reschedule state (#2703): what a drag drop and *Move to
 * date…* do, one per calendar. `Calendar.svelte` wires it to the grid. The
 * write is Minerva's, on the plugin's request (#2829, as a board's moves):
 * `view.reschedule` moves the note by whole days through the app's own
 * reschedule — its undo, its announcement, and a Local History entry that
 * says the Calendar did it — so this only decides the day count and the
 * words it speaks itself.
 *
 * - **A drop** moves the event by the days the drag gave (drop day − grab
 *   day).
 * - ***Move to date…*** (chosen in Minerva's note menu, which sends the
 *   `moveToDate` event, #2929) puts the grid in "choose a day" mode (`moving`):
 *   focus goes to the event's start day, the grid's keys move as always,
 *   and `confirm(day)` (Enter, a click on a day, or a typed date) moves it by
 *   `day − startDayOf(start)`. `cancel` (Escape, or focus leaving the
 *   calendar) moves nothing.
 * - **A refused event** (a start or end that is only a month or year) never
 *   enters the mode: the refusal is spoken instead.
 * - **⌘Z** (`onKeydown`) undoes the calendar's last move, never a board's.
 * - **A group** (#2938): a selection moved by *Move to date…* (the event's
 *   `paths`) or by dragging one of it moves every one by the same days, in
 *   one `view.reschedule` with `paths` — one undo. If any of them would be
 *   refused, none moves, and the refusal names each one (`groupRefusal`).
 */
import type { MinervaPlugin } from '/@minerva/plugin-api.js';
import { DAY_MS } from '../../../src/shared/time';
import { cardMoveKey } from './drag-keys';
import { dayName, type CalendarModel } from '../../../src/shared/calendar/calendar-model';
import { eventStartDay, refusalFor } from './reschedule';
import { groupRefusal } from '../../../src/shared/calendar/reschedule-refusal';
import type { TimelineProperties } from '../../../src/shared/timeline/timeline-events';

export interface RescheduleHost {
  minerva: MinervaPlugin;
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
  const quietly = (p: Promise<unknown>) => { p.catch(() => {}); };
  const announce = (text: string) => quietly(host.minerva.ui.announce({ text }));
  /** `paths`: the whole group moving with `key` (#2938), when it's more than one. */
  let moving = $state<{ key: string; title: string; from: number; paths: string[] | null } | null>(null);

  function refusalOf(key: string): string | null {
    const ev = host.model().byKey.get(key);
    return ev ? refusalFor(ev, host.dates()) : null;
  }

  /** A group of more than one, `key` among them (in the calendar's grid); null for one event. */
  function groupOf(key: string, paths: readonly string[] | undefined): string[] | null {
    const group = [...new Set(paths ?? [])].filter((p) => host.model().byKey.has(p));
    return group.length > 1 && group.includes(key) ? group : null;
  }
  /** Why the group can't move together (each refused one named), or null. */
  function groupRefusalOf(group: readonly string[]): string | null {
    return groupRefusal(group.map((key) => ({ title: host.model().byKey.get(key)?.title ?? key, refusal: refusalOf(key) })));
  }

  function move(key: string, days: number, paths?: readonly string[]): void {
    const ev = host.model().byKey.get(key);
    const from = ev ? eventStartDay(ev, host.dates()) : null;
    if (!ev || from === null || !host.interactive() || days === 0) return;
    const group = groupOf(key, paths);
    if (group) {
      const refusal = groupRefusalOf(group);
      if (refusal !== null) { announce(refusal); return; }
      quietly(host.minerva.view.reschedule({ path: key, days, paths: group }));
      return;
    }
    quietly(host.minerva.view.reschedule({ path: key, days }));
  }

  function start(key: string, paths?: readonly string[]): void {
    if (!host.interactive()) return;
    const ev = host.model().byKey.get(key);
    const group = groupOf(key, paths);
    const refusal = group ? groupRefusalOf(group) : refusalOf(key);
    if (refusal !== null) { announce(refusal); return; }
    const from = ev ? eventStartDay(ev, host.dates()) : null;
    if (!ev || from === null) return;
    host.closeList();
    moving = { key, title: ev.title, from, paths: group };
    host.focusDay(from);
  }

  function cancel(refocus: boolean): void {
    const m = moving;
    if (!m) return;
    moving = null;
    announce(m.paths ? `Move of ${m.paths.length} events cancelled.` : `Move of ${m.title} cancelled.`);
    if (refocus) host.focusDay(m.from);
  }

  function confirm(day: number): void {
    const m = moving;
    if (!m) return;
    moving = null;
    host.focusDay(day);
    if (day === m.from) announce(`${m.title} is already on ${dayName(day, host.locale())}.`);
    else move(m.key, Math.round((day - m.from) / DAY_MS), m.paths ?? undefined);
  }

  /** On the calendar's root: ⌘Z undoes the calendar's last move (a text field keeps its own undo). */
  function onKeydown(e: KeyboardEvent): void {
    if (!host.interactive() || cardMoveKey(e) !== 'undo') return;
    if ((e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    quietly(host.minerva.view.undoMove({}));
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
