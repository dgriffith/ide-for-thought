/**
 * @vitest-environment happy-dom
 *
 * Rescheduling on the Calendar (#2703), grid side: pointer drag (any segment
 * of a multi-day bar moves the whole event, with a drop preview; Escape
 * cancels; a click still opens the note), Minerva's note menu on every
 * event (#2929) and *Move to date…* from it (choose a day in the grid, or
 * type one), refusals for a
 * month-only end, ⌘Z, and a read-only embed that moves nothing. The write is
 * the `kanban-moves` store's — mocked here; its own test covers it.
 *
 * happy-dom has no layout, so each day cell is given a 100×80 box in grid
 * order, and a pointer lands on a cell by its centre.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, cleanup, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';


import { renderCalendar, type CalendarProps } from './fixtures';

// What the plugin asks Minerva for (#2829): a reschedule by whole days, an
// announcement, an undo. Minerva's half — the dates it writes, the days it
// names, the history cause — is calendar-reschedule.test.ts.
const h = { reschedule: vi.fn(), undo: vi.fn(), announce: vi.fn() };
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

function setup(over: Partial<CalendarProps> = {}) {
  const utils = renderCalendar({ type: EVENT, properties: EVENT.properties, instances: EVENTS, month: '2026-10', locale: 'en-GB', weekStart: 1, ...over });
  const { onOpenNote, onStateChange } = utils;
  const m = utils.api.minerva as unknown as { view: Record<string, unknown>; ui: Record<string, unknown> };
  m.view['reschedule'] = vi.fn(async (p: { path: string; days: number }) => { h.reschedule(p); return {}; });
  m.view['undoMove'] = vi.fn(async () => { h.undo(); return {}; });
  m.ui['announce'] = vi.fn(async (p: { text: string }) => { h.announce(p.text); return {}; });
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
  h.reschedule.mockReset();
  h.undo.mockReset();
  h.announce.mockReset();
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
    expect(h.reschedule).toHaveBeenCalledWith({ path: 'trip.md', days: 2 });
    expect(onOpenNote).not.toHaveBeenCalled(); // the click after a drag is swallowed
    expect(document.querySelector('[data-calendar-ghost]')).toBeNull();
    expect(cell(day(2026, 10, 15)).hasAttribute('data-drop-target')).toBe(false);
  });

  it('moves backwards across a week row, and onto the dimmed days of the next month', async () => {
    const { segs } = setup();
    await drag(segs('dentist.md')[0]!, at(day(2026, 10, 6)), at(day(2026, 9, 29)));
    expect(h.reschedule).toHaveBeenLastCalledWith(expect.objectContaining({ days: -7 }));
    await drag(segs('dentist.md')[0]!, at(day(2026, 10, 6)), at(day(2026, 11, 1)));
    expect(h.reschedule).toHaveBeenLastCalledWith(expect.objectContaining({ days: 26 }));
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

describe("Calendar: Minerva's note menu (#2929)", () => {
  async function press(key: string, opts: Record<string, unknown> = {}) {
    await fireEvent.keyDown(document.activeElement!, { key, ...opts });
    await tick();
    await tick();
  }
  const menus = (api: { of: (n: string) => unknown[] }) => api.of('ui.showNoteMenu') as Array<{ paths: string[] }>;

  it('a right-click on an event in the grid asks for the menu for that note, not its day', async () => {
    const { segs, api } = setup({ rowMenu: true });
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 });
    segs('dentist.md')[0]!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(api.of('ui.showNoteMenu')).toEqual([{ paths: ['dentist.md'], x: 30, y: 40 }]);
  });

  it("in a day's list, a right-click or Shift+F10 / ContextMenu on an event asks for it; the plugin draws no menu of its own", async () => {
    const { cell, api } = setup({ rowMenu: true });
    cell(day(2026, 10, 6)).focus();
    await press('Enter');
    const dlg = await screen.findByRole('dialog');
    const item = dlg.querySelector<HTMLElement>('[data-day-event]')!;
    await waitFor(() => expect(document.activeElement).toBe(item));
    expect(item.getAttribute('aria-haspopup')).toBe('menu');
    await press('F10', { shiftKey: true });
    await press('ContextMenu');
    await fireEvent.contextMenu(item);
    expect(menus(api).map((m) => m.paths)).toEqual([['dentist.md'], ['dentist.md'], ['dentist.md']]);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy(); // the list stays open
  });

  it('a band entry and an Undated row ask for it too, by pointer or the menu key', async () => {
    const { container, api } = setup({
      rowMenu: true,
      instances: [...EVENTS, row('month.md', 'Sometime', '2026-10'), row('nodate.md', 'No date', null)],
    });
    const chip = container.querySelector<HTMLElement>('.cal-chip[data-note-path="month.md"]')!;
    const undated = container.querySelector<HTMLElement>('.cal-undated-row[data-note-path="nodate.md"]')!;
    await fireEvent.contextMenu(chip);
    chip.focus();
    await press('ContextMenu');
    await fireEvent.contextMenu(undated);
    undated.focus();
    await press('F10', { shiftKey: true });
    expect(menus(api).map((m) => m.paths)).toEqual([['month.md'], ['month.md'], ['nodate.md'], ['nodate.md']]);
  });

  it('no menu where the view has none, or in an export: the right-click is left alone', async () => {
    const { segs, api } = setup();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    segs('dentist.md')[0]!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    cleanup();
    const exported = setup({ rowMenu: true, exportMode: true });
    await fireEvent.contextMenu(exported.container.querySelector<HTMLElement>('[data-note-path="dentist.md"]')!);
    expect(api.of('ui.showNoteMenu')).toEqual([]);
    expect(exported.api.of('ui.showNoteMenu')).toEqual([]);
  });
});

describe('Calendar: Move to date…, from the note menu (#2703, #2929)', () => {
  async function press(key: string, opts: Record<string, unknown> = {}) {
    await fireEvent.keyDown(document.activeElement!, { key, ...opts });
    await tick();
    await tick();
  }
  /** What Minerva sends when *Move to date…* is chosen in its menu. */
  async function chooseMoveToDate(api: { emit: (e: string, d: unknown) => void }, path: string) {
    api.emit('moveToDate', { path });
    await tick();
    await tick();
  }

  it("choose a day in the grid: focus goes to the event's day, arrows move, Enter moves it there", async () => {
    const { cell, q, api } = setup({ rowMenu: true });
    await chooseMoveToDate(api, 'dentist.md');
    await waitFor(() => expect(document.activeElement).toBe(cell(day(2026, 10, 6))));
    const bar = q('[data-calendar-move-bar]')!;
    expect(bar.textContent).toContain('Moving Dentist');
    expect(cell(day(2026, 10, 6)).getAttribute('aria-describedby')).toBe(bar.querySelector('.cal-movebar-text')!.id);
    expect(q('[data-calendar-event][data-note-path="dentist.md"]')!.hasAttribute('data-moving')).toBe(true);

    await press('ArrowRight');
    await press('ArrowDown');
    await press('Enter');
    expect(h.reschedule).toHaveBeenCalledWith({ path: 'dentist.md', days: 8 });
    expect(q('[data-calendar-move-bar]')).toBeNull();
    expect(document.activeElement).toBe(cell(day(2026, 10, 14)));
  });

  it("chosen from a day's list: the list closes and the grid chooses the day", async () => {
    const { cell, api } = setup({ rowMenu: true });
    cell(day(2026, 10, 6)).focus();
    await press('Enter');
    await screen.findByRole('dialog');
    await chooseMoveToDate(api, 'dentist.md');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(cell(day(2026, 10, 6))));
  });

  it('a click on a day moves it there too; the same day says so and writes nothing', async () => {
    const { cell, api } = setup({ rowMenu: true });
    await chooseMoveToDate(api, 'dentist.md');
    await fireEvent.click(cell(day(2026, 10, 6)));
    expect(h.reschedule).not.toHaveBeenCalled();
    expect(h.announce).toHaveBeenLastCalledWith(expect.stringMatching(/^Dentist is already on .*6 October 2026\.$/));

    await chooseMoveToDate(api, 'dentist.md');
    await fireEvent.click(cell(day(2026, 10, 2)));
    expect(h.reschedule).toHaveBeenCalledWith(expect.objectContaining({ days: -4 }));
  });

  it('or type a date: the page turns to it and the event moves there; a bad date is refused', async () => {
    const { onStateChange, api } = setup({ rowMenu: true });
    await chooseMoveToDate(api, 'dentist.md');
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Date to move Dentist to' });
    // Enter in the field, never a form submit: a plugin frame's sandbox has no allow-forms (#2829).
    await fireEvent.input(input, { target: { value: '2026-11' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(h.announce).toHaveBeenLastCalledWith('“2026-11” isn’t a day: type a date like 2026-10-12.');
    expect(h.reschedule).not.toHaveBeenCalled();

    await fireEvent.input(input, { target: { value: '2026-11-03' } });
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true); // no implicit submission
    expect(h.reschedule).toHaveBeenCalledWith(expect.objectContaining({ days: 28 }));
    expect(onStateChange).toHaveBeenLastCalledWith({ month: '2026-11' });
  });

  it('the Move button does what Enter does, without submitting a form', async () => {
    const { api } = setup({ rowMenu: true });
    await chooseMoveToDate(api, 'dentist.md');
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Date to move Dentist to' });
    await fireEvent.input(input, { target: { value: '2026-10-09' } });
    expect(screen.getByRole('button', { name: 'Move' }).getAttribute('type')).toBe('button');
    await fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(h.reschedule).toHaveBeenCalledWith({ path: 'dentist.md', days: 3 });
  });

  it("Escape cancels: nothing moves and focus returns to the event's day", async () => {
    const { cell, q, api } = setup({ rowMenu: true });
    await chooseMoveToDate(api, 'dentist.md');
    await waitFor(() => expect(document.activeElement).toBe(cell(day(2026, 10, 6))));
    await press('ArrowRight');
    await press('Escape');
    expect(q('[data-calendar-move-bar]')).toBeNull();
    expect(h.reschedule).not.toHaveBeenCalled();
    expect(h.announce).toHaveBeenLastCalledWith('Move of Dentist cancelled.');
    await waitFor(() => expect(document.activeElement).toBe(cell(day(2026, 10, 6))));
  });

  it("a refused event says why and doesn't start choosing", async () => {
    const { q, api } = setup({ rowMenu: true });
    await chooseMoveToDate(api, 'launch.md');
    expect(h.announce).toHaveBeenCalledWith('Launch ends 2026-11, which has no day to move; open it to edit.');
    expect(q('[data-calendar-move-bar]')).toBeNull();
  });

  it('read-only (an embed): a stray request moves nothing', async () => {
    const { q, api } = setup({ rowMenu: true, readOnly: true });
    await chooseMoveToDate(api, 'dentist.md');
    expect(q('[data-calendar-move-bar]')).toBeNull();
  });
});

describe('Calendar: ⌘Z (#2703)', () => {
  it('on the grid undoes the calendar\'s last move; read-only it does nothing', async () => {
    const { cell } = setup();
    cell(day(2026, 10, 6)).focus();
    await fireEvent.keyDown(cell(day(2026, 10, 6)), { key: 'z', metaKey: true });
    expect(h.undo).toHaveBeenCalledOnce(); // the calendar's own surface: Minerva's to choose
    cleanup();
    h.undo.mockClear();
    const ro = setup({ readOnly: true });
    await fireEvent.keyDown(ro.cell(day(2026, 10, 6)), { key: 'z', metaKey: true });
    expect(h.undo).not.toHaveBeenCalled();
  });
});

describe('Calendar: several events (#2938)', () => {
  const TAB = { rowMenu: true, selectable: true } as const;
  const clicks = (api: { of: (n: string) => unknown[] }) => api.of('view.click');
  const menus = (api: { of: (n: string) => unknown[] }) => (api.of('ui.showNoteMenu') as Array<{ paths: string[] }>).map((m) => m.paths);
  async function press(key: string, opts: Record<string, unknown> = {}) {
    await fireEvent.keyDown(document.activeElement!, { key, ...opts });
    await tick();
    await tick();
  }
  const WITH_BANDS = [...EVENTS, row('month.md', 'Sometime', '2026-10'), row('nodate.md', 'No date', null)];

  it('a click carries its modifiers where the view selects — on the grid, a band and Undated; elsewhere it just opens', async () => {
    const { segs, container, api } = setup({ ...TAB, instances: WITH_BANDS });
    await fireEvent.click(segs('dentist.md')[0]!, { metaKey: true });
    await fireEvent.click(container.querySelector<HTMLElement>('.cal-chip[data-note-path="month.md"]')!, { shiftKey: true });
    await fireEvent.click(container.querySelector<HTMLElement>('.cal-undated-row[data-note-path="nodate.md"]')!, { ctrlKey: true });
    expect(clicks(api)).toEqual([
      { path: 'dentist.md', meta: true, ctrl: false, shift: false },
      { path: 'month.md', meta: false, ctrl: false, shift: true },
      { path: 'nodate.md', meta: false, ctrl: true, shift: false },
    ]);
    cleanup();
    const embed = setup({ rowMenu: true });
    await fireEvent.click(embed.segs('dentist.md')[0]!, { metaKey: true });
    expect(clicks(embed.api)).toEqual([{ path: 'dentist.md' }]);
  });

  it('draws the selection on the grid, a band, Undated and the day list', async () => {
    const { segs, container, cell } = setup({ ...TAB, instances: WITH_BANDS, selected: ['dentist.md', 'month.md', 'nodate.md'] });
    expect(segs('dentist.md')[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(segs('trip.md')[0]!.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.cal-chip[data-note-path="month.md"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.cal-undated-row[data-note-path="nodate.md"]')!.getAttribute('aria-pressed')).toBe('true');
    cell(day(2026, 10, 6)).focus();
    await press('Enter');
    const item = (await screen.findByRole('dialog')).querySelector<HTMLElement>('[data-day-event][data-note-path="dentist.md"]')!;
    expect(item.getAttribute('aria-pressed')).toBe('true');
  });

  it("a right-click on a selected event is the selection's menu; on any other, that note's", async () => {
    const { segs, api } = setup({ ...TAB, selected: ['dentist.md', 'trip.md'] });
    await fireEvent.contextMenu(segs('trip.md')[0]!);
    await fireEvent.contextMenu(segs('launch.md')[0]!);
    expect(menus(api)).toEqual([['dentist.md', 'trip.md'], ['launch.md']]);
  });

  it('⌘A selects all, and Escape clears a selection — through the view', async () => {
    const { cell, api, rerender } = setup(TAB);
    cell(day(2026, 10, 6)).focus();
    await press('a', { metaKey: true });
    expect(api.of('view.selectAll')).toHaveLength(1);
    await press('Escape');
    expect(api.of('view.clearSelection')).toHaveLength(0); // nothing selected yet
    await rerender({ selected: ['dentist.md'] });
    await press('Escape');
    expect(api.of('view.clearSelection')).toHaveLength(1);
  });

  it("in a day's list, Space toggles and ⇧+↓ extends to the next event, keeping the list open", async () => {
    const both = [row('a.md', 'Alpha', '2026-10-06T09:00'), row('b.md', 'Bravo', '2026-10-06T10:00')];
    const { cell, api } = setup({ ...TAB, instances: both });
    cell(day(2026, 10, 6)).focus();
    await press('Enter');
    const dlg = await screen.findByRole('dialog');
    const items = () => [...dlg.querySelectorAll<HTMLElement>('[data-day-event]')];
    await waitFor(() => expect(document.activeElement).toBe(items()[0]));
    await press(' ');
    await press('ArrowDown', { shiftKey: true });
    expect(clicks(api)).toEqual([{ path: 'a.md', meta: true }, { path: 'a.md', meta: true }, { path: 'b.md', shift: true }]);
    expect(document.activeElement).toBe(items()[1]);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Move to date… for a selection chooses the day for the event the menu was on, and moves them all in one request', async () => {
    const { segs, cell, q, api } = setup({ ...TAB, selected: ['dentist.md', 'trip.md'] });
    await fireEvent.contextMenu(segs('trip.md')[0]!);
    api.emit('moveToDate', { path: 'dentist.md', paths: ['dentist.md', 'trip.md'] });
    await waitFor(() => expect(document.activeElement).toBe(cell(day(2026, 10, 9))));
    expect(q('[data-calendar-move-bar]')!.textContent).toContain('Moving 2 events: choose a day for Trip');
    await press('ArrowRight');
    await press('Enter');
    expect(h.reschedule).toHaveBeenCalledOnce();
    expect(h.reschedule).toHaveBeenCalledWith({ path: 'trip.md', days: 1, paths: ['dentist.md', 'trip.md'] });
  });

  it('a selection with an event that can\'t move moves none, naming it, and never starts choosing', async () => {
    const { q, api } = setup({ ...TAB, selected: ['dentist.md', 'launch.md'] });
    api.emit('moveToDate', { path: 'dentist.md', paths: ['dentist.md', 'launch.md'] });
    await tick();
    await tick();
    expect(q('[data-calendar-move-bar]')).toBeNull();
    expect(h.announce).toHaveBeenCalledWith(expect.stringMatching(/^Can't move these 2 events together\. Launch .* Deselect it to move the rest\.$/));
  });

  it('dragging a selected event moves the selection by the drag; with a refused one in it, none', async () => {
    const { segs, rerender } = setup({ ...TAB, selected: ['dentist.md', 'trip.md'] });
    await drag(segs('dentist.md')[0]!, at(day(2026, 10, 6)), at(day(2026, 10, 8)));
    expect(h.reschedule).toHaveBeenCalledWith({ path: 'dentist.md', days: 2, paths: ['dentist.md', 'trip.md'] });
    // An unselected event drags alone.
    await rerender({ selected: ['trip.md', 'launch.md'] });
    await drag(segs('dentist.md')[0]!, at(day(2026, 10, 6)), at(day(2026, 10, 7)));
    expect(h.reschedule).toHaveBeenLastCalledWith({ path: 'dentist.md', days: 1 });
    await drag(segs('trip.md')[0]!, at(day(2026, 10, 9)), at(day(2026, 10, 10)));
    expect(h.reschedule).toHaveBeenCalledTimes(2);
    expect(h.announce).toHaveBeenLastCalledWith(expect.stringMatching(/^Can't move these 2 events together\./));
  });
});
