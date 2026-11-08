/**
 * @vitest-environment happy-dom
 *
 * Moving and resizing timed events by time in the Week and Day grids (#2953):
 * dragging an event's body (another time, another day), its bottom edge (its
 * end), the 15-minute snap of the edge that moves, the preview, Escape, the
 * click after a drag, the keyboard (Alt+↑/↓, Alt+Shift+↑/↓) and focus
 * following the event, refusals, and nothing at all read-only. The write is
 * Minerva's: these assert on the `view.retime` / `view.resize` calls.
 *
 * happy-dom has no layout: the hour cells are laid out here as 100×24 boxes,
 * one column per day.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { renderCalendar, type CalendarProps } from './fixtures';
import { civilMs } from '../../../src/shared/objects/date-precision';
import { snappedMove, snapMinute } from '../../../plugins/calendar/src/time-drag';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';

const EVENT = {
  id: 'event', label: 'Event', icon: '📅',
  properties: [{ name: 'date', type: 'datetime' }, { name: 'end', type: 'datetime' }],
};
const row = (path: string, title: string, date: string | null, end: string | null = null): TypeInstanceRow =>
  ({ path, title, values: { date, end }, cover: null });
const EVENTS = [
  row('review.md', 'Design review', '2026-10-07T09:00', '2026-10-07T11:00'),
  row('holiday.md', 'Holiday', '2026-10-06'),
];
const day = (y: number, m: number, d: number) => civilMs(y, m - 1, d);
const WED = day(2026, 10, 7);

// ── A layout: hour cells 100 wide and 24 tall, a column per day ────────────
const realRect = HTMLElement.prototype.getBoundingClientRect;
const COL_W = 100;
const SLOT_H = 24;
function columnOf(dayMs: number): number {
  const days = [...new Set([...document.querySelectorAll<HTMLElement>('[role="gridcell"][data-slot="0"]')].map((c) => Number(c.dataset['day'])))];
  return days.indexOf(dayMs);
}
/** A point in the hour grid: a day's column, at `minute` past its midnight. */
function at(dayMs: number, minute: number): { clientX: number; clientY: number } {
  return { clientX: columnOf(dayMs) * COL_W + 50, clientY: (minute / 30) * SLOT_H };
}

function setup(over: Partial<CalendarProps> = {}) {
  const utils = renderCalendar({
    type: EVENT, properties: EVENT.properties, instances: EVENTS, mode: 'week', date: '2026-10-07', locale: 'en-GB', weekStart: 1, ...over,
  });
  const q = (sel: string) => utils.container.querySelector<HTMLElement>(sel);
  const ev = (path: string) => q(`.wk-ev[data-note-path="${path}"]`)!;
  return { ...utils, q, ev };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 8, 0));
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const slot = Number(this.dataset['slot']);
    if (this.getAttribute('role') === 'gridcell' && this.dataset['day'] !== undefined && slot >= 0) {
      const x = columnOf(Number(this.dataset['day'])) * COL_W;
      const y = slot * SLOT_H;
      return { left: x, top: y, right: x + COL_W, bottom: y + SLOT_H, width: COL_W, height: SLOT_H, x, y, toJSON() { return {}; } };
    }
    return realRect.call(this);
  };
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
  cleanup();
  vi.useRealTimers();
});

async function drag(from: HTMLElement, start: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }, opts: { release?: boolean } = {}) {
  await fireEvent.pointerDown(from, { button: 0, pointerId: 1, ...start });
  await fireEvent.pointerMove(window, { pointerId: 1, clientX: start.clientX, clientY: start.clientY + 10 });
  await fireEvent.pointerMove(window, { pointerId: 1, ...to });
  if (opts.release !== false) {
    await fireEvent.pointerUp(window, { pointerId: 1, ...to });
    await fireEvent.click(from);
  }
}

describe('snapping (#2953)', () => {
  it('snaps the moving edge to 15 minutes, not the pointer', () => {
    expect(snapMinute(547)).toBe(540); // 9:07 → 9:00
    expect(snapMinute(553)).toBe(555);
    expect(snappedMove(540, 62)).toBe(60); // 9:00 dragged 62 minutes lands on 10:00
    expect(snappedMove(550, 47)).toBe(50); // 9:10 dragged 47 lands on 10:00
    expect(snappedMove(540, 5)).toBe(0); // not far enough to move
  });
});

describe('dragging a timed event (#2953)', () => {
  it('its body moves it to another time: view.retime by the minutes, and the click doesn\'t open it', async () => {
    const s = setup();
    await drag(s.ev('review.md'), at(WED, 9 * 60 + 10), at(WED, 10 * 60 + 12));
    expect(s.api.of('view.retime')).toEqual([{ path: 'review.md', minutes: 60 }]);
    expect(s.onOpenNote).not.toHaveBeenCalled();
  });

  it('to another day in the week, at another time', async () => {
    const s = setup();
    await drag(s.ev('review.md'), at(WED, 9 * 60), at(day(2026, 10, 9), 8 * 60 + 30));
    expect(s.api.of('view.retime')).toEqual([{ path: 'review.md', minutes: 2 * 1440 - 30 }]);
  });

  it('shows where it would land while dragging, and Escape asks nothing', async () => {
    const s = setup();
    const el = s.ev('review.md');
    await drag(el, at(WED, 9 * 60), at(WED, 10 * 60 + 45), { release: false });
    expect(el.dataset['dragging']).toBe('move');
    expect(el.dataset['dropTime']).toBe('10:45');
    expect(el.style.transform).toBe(`translate(0px, ${105 * (SLOT_H / 30)}px)`);
    await fireEvent.keyDown(window, { key: 'Escape' });
    await fireEvent.pointerUp(window, { pointerId: 1, ...at(WED, 10 * 60 + 45) });
    expect(s.api.of('view.retime')).toEqual([]);
    expect(el.style.transform).toBe('');
    expect(el.hasAttribute('data-dragging')).toBe(false);
  });

  it('a drag lets the hover preview go and opens no other: the app draws it over the frame, where the drag would be lost', async () => {
    const s = setup({ instances: [...EVENTS, row('call.md', 'Call', '2026-10-07T12:00', '2026-10-07T12:30')] });
    const el = s.ev('review.md');
    await fireEvent.pointerEnter(el);
    expect(s.api.of('ui.previewNote')).toHaveLength(1);
    await drag(el, at(WED, 9 * 60), at(WED, 12 * 60), { release: false });
    expect(s.api.of('ui.hidePreview')).toEqual([expect.objectContaining({ path: 'review.md' })]);
    await fireEvent.pointerEnter(s.ev('call.md')); // crossed mid-drag
    expect(s.api.of('ui.previewNote')).toHaveLength(1);
    await fireEvent.pointerUp(window, { pointerId: 1, ...at(WED, 12 * 60) });
    await fireEvent.pointerEnter(s.ev('call.md')); // after it, previews come back
    expect(s.api.of('ui.previewNote')).toHaveLength(2);
  });

  it('its bottom edge resizes it: view.resize by how far the end moved', async () => {
    const s = setup();
    const handle = s.ev('review.md').querySelector<HTMLElement>('[data-resize-handle]')!;
    await drag(handle, at(WED, 11 * 60 - 2), at(WED, 11 * 60 + 28));
    expect(s.api.of('view.resize')).toEqual([{ path: 'review.md', minutes: 30 }]);
    expect(s.api.of('view.retime')).toEqual([]);
  });

  it('a click without a drag still opens the note', async () => {
    const s = setup();
    const el = s.ev('review.md');
    await fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...at(WED, 9 * 60) });
    await fireEvent.pointerUp(window, { pointerId: 1, ...at(WED, 9 * 60) });
    await fireEvent.click(el);
    expect(s.onOpenNote).toHaveBeenCalledWith('review.md');
  });

  it('read-only (an embed): no handle, and a drag asks nothing', async () => {
    const s = setup({ readOnly: true });
    expect(s.ev('review.md').querySelector('[data-resize-handle]')).toBeNull();
    await drag(s.ev('review.md'), at(WED, 9 * 60), at(WED, 11 * 60));
    expect(s.api.of('view.retime')).toEqual([]);
  });

  it('a resize where the view has no end field is refused aloud', async () => {
    const s = setup({ properties: [{ name: 'date', type: 'datetime' }] });
    const handle = s.ev('review.md').querySelector<HTMLElement>('[data-resize-handle]')!;
    await drag(handle, at(WED, 9 * 60 + 28), at(WED, 10 * 60 + 28));
    expect(s.api.of('view.resize')).toEqual([]);
    expect(s.api.of('ui.announce')).toEqual([{ text: 'Design review has no end to change in this view.' }]);
  });
});

describe('moving by keyboard (#2953)', () => {
  it('Alt+↓/↑ moves a focused event 15 minutes; with Shift its end', async () => {
    const s = setup();
    const el = s.ev('review.md');
    el.focus();
    await fireEvent.keyDown(el, { key: 'ArrowDown', altKey: true });
    await fireEvent.keyDown(el, { key: 'ArrowUp', altKey: true });
    await fireEvent.keyDown(el, { key: 'ArrowUp', altKey: true, shiftKey: true });
    expect(s.api.of('view.retime')).toEqual([{ path: 'review.md', minutes: 15 }, { path: 'review.md', minutes: -15 }]);
    expect(s.api.of('view.resize')).toEqual([{ path: 'review.md', minutes: -15 }]);
    expect(el.getAttribute('aria-keyshortcuts')).toContain('Alt+ArrowDown');
  });

  it('focus follows the event to where it is drawn next', async () => {
    const s = setup();
    s.ev('review.md').focus();
    await fireEvent.keyDown(s.ev('review.md'), { key: 'ArrowDown', altKey: true });
    // Minerva writes, and the view comes back with the note moved: a new cell, a new element.
    await s.rerender({ instances: [row('review.md', 'Design review', '2026-10-07T09:15', '2026-10-07T11:15'), EVENTS[1]!] });
    await tick();
    await tick();
    const moved = s.ev('review.md');
    expect(moved.dataset['startMin']).toBe('555');
    expect(document.activeElement).toBe(moved);
  });

  it('an all-day bar doesn\'t move by time', async () => {
    const s = setup();
    const bar = s.q('.wk-bar[data-note-path="holiday.md"]')!;
    bar.focus();
    await fireEvent.keyDown(bar, { key: 'ArrowDown', altKey: true });
    expect(s.api.of('view.retime')).toEqual([]);
  });

  it('the month grid has none of it', async () => {
    const s = setup({ mode: null, date: null });
    expect(s.q('.wk-ev')).toBeNull();
    expect(s.q('[data-resize-handle]')).toBeNull();
  });
});
