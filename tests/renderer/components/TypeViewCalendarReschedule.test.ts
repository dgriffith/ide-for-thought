/**
 * @vitest-environment happy-dom
 *
 * Rescheduling on the Calendar (#2703), grid side: pointer drag (any segment
 * of a multi-day bar moves the whole event, with a drop preview; Escape
 * cancels; a click still opens the note), the day list's event menu and
 * *Move to date…* (choose a day in the grid, or type one), refusals for a
 * month-only end, ⌘Z, and a read-only embed that moves nothing. The write is
 * the `kanban-moves` store's — mocked here; its own test covers it.
 *
 * happy-dom has no layout, so each day cell is given a 100×80 box in grid
 * order, and a pointer lands on a cell by its centre.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

const h = vi.hoisted(() => ({ reschedule: vi.fn(), undo: vi.fn(), announce: vi.fn() }));
vi.mock('../../../src/renderer/lib/stores/kanban-moves.svelte', () => ({
  getKanbanMoveStore: () => ({ revision: 0, lastMove: null, rescheduleEvent: h.reschedule, undoLastMove: h.undo }),
}));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: h.announce }));
vi.mock('../../../src/renderer/lib/stores/settings-calendar.svelte', () => ({
  getCalendarSettings: () => ({ weekStart: 1, showWeekNumbers: false }),
}));

import TypeViewCalendar from '../../../src/renderer/lib/components/TypeViewCalendar.svelte';
import { civilMs } from '../../../src/shared/objects/date-precision';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';

const EVENT = {
  id: 'event', label: 'Event', classLocalName: 'Event', icon: '📅', source: 'stock' as const,
  properties: [{ name: 'date', type: 'datetime' as const }, { name: 'end', type: 'datetime' as const }],
};
const row = (path: string, title: string, date: string | null, end: string | null = null): TypeInstanceRow =>
  ({ path, title, values: { date, end }, cover: null });
// October 2026, Monday start: rows 28 Sep–4 Oct, 5–11, 12–18, 19–25, 26 Oct–1 Nov.
const EVENTS = [
  row('dentist.md', 'Dentist', '2026-10-06'),
  row('trip.md', 'Trip', '2026-10-09', '2026-10-14'),
  row('launch.md', 'Launch', '2026-10-20', '2026-11'),
];
const day = (y: number, m: number, d: number) => civilMs(y, m - 1, d);
const FIELDS = { start: 'date', end: 'end' };

function setup(over: Record<string, unknown> = {}) {
  const onOpenNote = vi.fn();
  const onStateChange = vi.fn();
  const utils = render(TypeViewCalendar, {
    type: EVENT, properties: EVENT.properties, instances: EVENTS, month: '2026-10',
    display: (_p: unknown, v: string | null) => v ?? '', rowType: () => EVENT,
    onOpenNote, onStateChange, locale: 'en-GB', weekStart: 1, ...over,
  });
  const q = (sel: string) => utils.container.querySelector<HTMLElement>(sel);
  const cell = (ms: number) => q(`[role="gridcell"][data-day="${ms}"]`)!;
  const segs = (path: string) => [...utils.container.querySelectorAll<HTMLElement>(`[data-calendar-event][data-note-path="${path}"]`)];
  return { ...utils, onOpenNote, onStateChange, q, cell, segs };
}

// ── A layout for happy-dom: cells in a 7-wide grid of 100×80 boxes ──────────
const realRect = HTMLElement.prototype.getBoundingClientRect;
function cells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="gridcell"][data-day]')];
}
function at(ms: number): { clientX: number; clientY: number } {
  const i = cells().findIndex((c) => Number(c.dataset['day']) === ms);
  return { clientX: (i % 7) * 100 + 50, clientY: Math.floor(i / 7) * 80 + 40 };
}
beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.getAttribute('role') === 'gridcell' && this.dataset['day'] !== undefined) {
      const i = cells().indexOf(this);
      const x = (i % 7) * 100;
      const y = Math.floor(i / 7) * 80;
      return { left: x, top: y, right: x + 100, bottom: y + 80, width: 100, height: 80, x, y, toJSON() { return {}; } };
    }
    return realRect.call(this);
  };
  h.reschedule.mockResolvedValue({ ok: true, paths: [] });
  h.undo.mockResolvedValue([]);
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
  cleanup();
  vi.clearAllMocks();
  document.querySelectorAll('[data-calendar-ghost]').forEach((g) => g.remove());
});

async function drag(from: HTMLElement, start: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }, release = true) {
  await fireEvent.pointerDown(from, { button: 0, pointerId: 1, ...start });
  await fireEvent.pointerMove(window, { pointerId: 1, clientX: start.clientX + 20, clientY: start.clientY });
  await fireEvent.pointerMove(window, { pointerId: 1, ...to });
  if (release) {
    await fireEvent.pointerUp(window, { pointerId: 1, ...to });
    await fireEvent.click(from);
  }
}

describe('Calendar: pointer drag (#2703)', () => {
  it('dragging the SECOND segment of a multi-day bar moves the whole event by drop day − grab day', async () => {
    const { segs, cell, onOpenNote } = setup();
    const second = segs('trip.md')[1]!; // 12–14 Oct, the second week row
    await drag(second, at(day(2026, 10, 13)), at(day(2026, 10, 15)), false);

    // The preview: the cells the whole event would cover (9–14 Oct + 2 → 11–16 Oct).
    const preview = cells().filter((c) => c.hasAttribute('data-drop-target')).map((c) => new Date(Number(c.dataset['day'])).getUTCDate());
    expect(preview).toEqual([11, 12, 13, 14, 15, 16]);
    expect(document.querySelector('[data-calendar-ghost]')).not.toBeNull();
    expect(segs('trip.md').every((s) => s.hasAttribute('data-dragging'))).toBe(true);

    await fireEvent.pointerUp(window, { pointerId: 1, ...at(day(2026, 10, 15)) });
    await fireEvent.click(second);
    expect(h.reschedule).toHaveBeenCalledWith(
      { path: 'trip.md', title: 'Trip' }, FIELDS, 2,
      { to: expect.stringContaining('11 October 2026'), back: expect.stringContaining('9 October 2026') },
    );
    expect(onOpenNote).not.toHaveBeenCalled(); // the click after a drag is swallowed
    expect(document.querySelector('[data-calendar-ghost]')).toBeNull();
    expect(cell(day(2026, 10, 15)).hasAttribute('data-drop-target')).toBe(false);
  });

  it('moves backwards across a week row, and onto the dimmed days of the next month', async () => {
    const { segs } = setup();
    await drag(segs('dentist.md')[0]!, at(day(2026, 10, 6)), at(day(2026, 9, 29)));
    expect(h.reschedule).toHaveBeenLastCalledWith(expect.anything(), FIELDS, -7, expect.anything());
    await drag(segs('dentist.md')[0]!, at(day(2026, 10, 6)), at(day(2026, 11, 1)));
    expect(h.reschedule).toHaveBeenLastCalledWith(expect.anything(), FIELDS, 26, expect.anything());
  });

  it('Escape cancels: nothing moves, the ghost and preview go', async () => {
    const { segs } = setup();
    await drag(segs('dentist.md')[0]!, at(day(2026, 10, 6)), at(day(2026, 10, 8)), false);
    await fireEvent.keyDown(window, { key: 'Escape' });
    await fireEvent.pointerUp(window, { pointerId: 1, ...at(day(2026, 10, 8)) });
    expect(h.reschedule).not.toHaveBeenCalled();
    expect(document.querySelector('[data-calendar-ghost]')).toBeNull();
    expect(cells().some((c) => c.hasAttribute('data-drop-target'))).toBe(false);
  });

  it('a release on the grab day, or off the grid, moves nothing', async () => {
    const { segs } = setup();
    await drag(segs('dentist.md')[0]!, at(day(2026, 10, 6)), at(day(2026, 10, 6)));
    await drag(segs('dentist.md')[0]!, at(day(2026, 10, 6)), { clientX: 5000, clientY: 5000 });
    expect(h.reschedule).not.toHaveBeenCalled();
  });

  it('a click without movement still opens the note', async () => {
    const { segs, onOpenNote } = setup();
    const ev = segs('dentist.md')[0]!;
    await fireEvent.pointerDown(ev, { button: 0, pointerId: 1, ...at(day(2026, 10, 6)) });
    await fireEvent.pointerUp(window, { pointerId: 1, ...at(day(2026, 10, 6)) });
    await fireEvent.click(ev);
    expect(onOpenNote).toHaveBeenCalledWith('dentist.md');
    expect(h.reschedule).not.toHaveBeenCalled();
  });

  it('an event whose end is only a month doesn\'t drag: it says why, and the release doesn\'t open it', async () => {
    const { segs, onOpenNote } = setup();
    const launch = segs('launch.md')[0]!;
    expect(launch.classList.contains('cal-fixed')).toBe(true);
    await drag(launch, at(day(2026, 10, 20)), at(day(2026, 10, 22)));
    expect(h.announce).toHaveBeenCalledOnce();
    expect(h.announce).toHaveBeenCalledWith('Launch ends 2026-11, which has no day to move; open it to edit.');
    expect(document.querySelector('[data-calendar-ghost]')).toBeNull();
    expect(h.reschedule).not.toHaveBeenCalled();
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it('read-only (an embed): nothing drags', async () => {
    const { segs, onOpenNote } = setup({ readOnly: true });
    await drag(segs('dentist.md')[0]!, at(day(2026, 10, 6)), at(day(2026, 10, 8)));
    expect(document.querySelector('[data-calendar-ghost]')).toBeNull();
    expect(h.reschedule).not.toHaveBeenCalled();
    expect(onOpenNote).toHaveBeenCalledWith('dentist.md'); // a plain click, as before
  });
});

describe('Calendar: Move to date… (#2703)', () => {
  async function press(key: string, opts: Record<string, unknown> = {}) {
    await fireEvent.keyDown(document.activeElement!, { key, ...opts });
    await tick();
    await tick();
  }
  /** Focus a day, open its list, and open the menu on its first event. */
  async function openMenu(cell: HTMLElement) {
    cell.focus();
    await press('Enter');
    const dlg = await screen.findByRole('dialog');
    await waitFor(() => expect(document.activeElement).toBe(dlg.querySelector('[data-day-event]')));
    await press('F10', { shiftKey: true });
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(document.activeElement).toBe(menu.querySelector('[role="menuitem"]')));
    return menu;
  }

  it('Shift+F10 in the day list opens the event\'s menu; Escape closes it back onto the event', async () => {
    const { cell } = setup();
    const menu = await openMenu(cell(day(2026, 10, 6)));
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual(['Move to date…', 'Open']);
    await press('ArrowDown');
    expect(document.activeElement?.textContent).toBe('Open');
    await press('Escape');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect((document.activeElement as HTMLElement).dataset['notePath']).toBe('dentist.md'));
    expect(screen.getByRole('dialog')).toBeTruthy(); // the list stays open
  });

  it('the ContextMenu key opens it too, and Open opens the note', async () => {
    const { cell, onOpenNote } = setup();
    cell(day(2026, 10, 6)).focus();
    await press('Enter');
    const dlg = await screen.findByRole('dialog');
    await waitFor(() => expect(document.activeElement).toBe(dlg.querySelector('[data-day-event]')));
    await press('ContextMenu');
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Open' }));
    expect(onOpenNote).toHaveBeenCalledWith('dentist.md');
  });

  it('choose a day in the grid: focus goes to the event\'s day, arrows move, Enter moves it there', async () => {
    const { cell, q } = setup();
    await openMenu(cell(day(2026, 10, 6)));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Move to date…' }));
    await waitFor(() => expect(document.activeElement).toBe(cell(day(2026, 10, 6))));
    expect(screen.queryByRole('dialog')).toBeNull();
    const bar = q('[data-calendar-move-bar]')!;
    expect(bar.textContent).toContain('Moving Dentist');
    expect(cell(day(2026, 10, 6)).getAttribute('aria-describedby')).toBe(bar.querySelector('.cal-movebar-text')!.id);
    expect(q('[data-calendar-event][data-note-path="dentist.md"]')!.hasAttribute('data-moving')).toBe(true);

    await press('ArrowRight');
    await press('ArrowDown');
    await press('Enter');
    expect(h.reschedule).toHaveBeenCalledWith(
      { path: 'dentist.md', title: 'Dentist' }, FIELDS, 8,
      { to: expect.stringContaining('14 October 2026'), back: expect.stringContaining('6 October 2026') },
    );
    expect(q('[data-calendar-move-bar]')).toBeNull();
    expect(document.activeElement).toBe(cell(day(2026, 10, 14)));
  });

  it('a click on a day moves it there too; the same day says so and writes nothing', async () => {
    const { cell } = setup();
    await openMenu(cell(day(2026, 10, 6)));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Move to date…' }));
    await fireEvent.click(cell(day(2026, 10, 6)));
    expect(h.reschedule).not.toHaveBeenCalled();
    expect(h.announce).toHaveBeenLastCalledWith(expect.stringMatching(/^Dentist is already on .*6 October 2026\.$/));

    await openMenu(cell(day(2026, 10, 6)));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Move to date…' }));
    await fireEvent.click(cell(day(2026, 10, 2)));
    expect(h.reschedule).toHaveBeenCalledWith(expect.anything(), FIELDS, -4, expect.anything());
  });

  it('or type a date: the page turns to it and the event moves there; a bad date is refused', async () => {
    const { cell, onStateChange } = setup();
    await openMenu(cell(day(2026, 10, 6)));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Move to date…' }));
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Date to move Dentist to' });
    await fireEvent.input(input, { target: { value: '2026-11' } });
    await fireEvent.submit(input.form!);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(h.announce).toHaveBeenLastCalledWith('“2026-11” isn’t a day: type a date like 2026-10-12.');
    expect(h.reschedule).not.toHaveBeenCalled();

    await fireEvent.input(input, { target: { value: '2026-11-03' } });
    await fireEvent.submit(input.form!);
    expect(h.reschedule).toHaveBeenCalledWith(expect.anything(), FIELDS, 28, { to: expect.stringContaining('3 November 2026'), back: expect.anything() });
    expect(onStateChange).toHaveBeenLastCalledWith({ month: '2026-11' });
  });

  it('Escape cancels: nothing moves and focus returns to the event\'s day', async () => {
    const { cell, q } = setup();
    await openMenu(cell(day(2026, 10, 6)));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Move to date…' }));
    await waitFor(() => expect(document.activeElement).toBe(cell(day(2026, 10, 6))));
    await press('ArrowRight');
    await press('Escape');
    expect(q('[data-calendar-move-bar]')).toBeNull();
    expect(h.reschedule).not.toHaveBeenCalled();
    expect(h.announce).toHaveBeenLastCalledWith('Move of Dentist cancelled.');
    await waitFor(() => expect(document.activeElement).toBe(cell(day(2026, 10, 6))));
  });

  it('a refused event: Move to date… is disabled with the reason, and choosing it says why', async () => {
    const { cell, q } = setup();
    const menu = await openMenu(cell(day(2026, 10, 20)));
    const move = screen.getByRole('menuitem', { name: 'Move to date…' });
    expect(move.getAttribute('aria-disabled')).toBe('true');
    const note = menu.querySelector('[data-menu-refusal]')!;
    expect(note.textContent).toBe('Launch ends 2026-11, which has no day to move; open it to edit.');
    expect(move.getAttribute('aria-describedby')).toBe(note.id);
    await fireEvent.click(move);
    expect(h.announce).toHaveBeenCalledWith('Launch ends 2026-11, which has no day to move; open it to edit.');
    expect(q('[data-calendar-move-bar]')).toBeNull();
  });

  it('read-only: no menu', async () => {
    const { cell } = setup({ readOnly: true });
    cell(day(2026, 10, 6)).focus();
    await press('Enter');
    const dlg = await screen.findByRole('dialog');
    await waitFor(() => expect(document.activeElement).toBe(dlg.querySelector('[data-day-event]')));
    await press('F10', { shiftKey: true });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Calendar: ⌘Z (#2703)', () => {
  it('on the grid undoes the calendar\'s last move; read-only it does nothing', async () => {
    const { cell } = setup();
    cell(day(2026, 10, 6)).focus();
    await fireEvent.keyDown(cell(day(2026, 10, 6)), { key: 'z', metaKey: true });
    expect(h.undo).toHaveBeenCalledWith('calendar');
    cleanup();
    h.undo.mockClear();
    const ro = setup({ readOnly: true });
    await fireEvent.keyDown(ro.cell(day(2026, 10, 6)), { key: 'z', metaKey: true });
    expect(h.undo).not.toHaveBeenCalled();
  });
});
