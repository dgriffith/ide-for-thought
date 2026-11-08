/**
 * @vitest-environment jsdom
 *
 * A type view's Calendar layout (#2701, #2702), end to end in the renderer:
 * since #2829 the calendar is the built-in Calendar plugin's, so these run it
 * in loopback (`plugin-loopback.ts`) — its real view, drawn beside the frame
 * from the view TypeView sends, its page written back through the host.
 * jsdom, not happy-dom, which logs an error for every plugin frame it won't
 * load. The calendar itself is tested in tests/plugins/calendar/.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  instances: vi.fn(), list: vi.fn(), noteTypeMap: vi.fn(), reschedule: vi.fn(), undo: vi.fn(),
  loop: {} as import('./plugin-loopback').LoopbackState,
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: h.instances, list: h.list, noteTypeMap: h.noteTypeMap }, app: { getSystemLocale: async () => 'en-GB' } },
}));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: (...a: unknown[]) => h.loop.connect(...a) }));
// The move store's own test covers the write; here, what the view asks of it.
vi.mock('../../../src/renderer/lib/stores/kanban-moves.svelte', () => ({
  getKanbanMoveStore: () => ({ revision: 0, lastMove: null, canUndo: true, canUndoReschedule: false, moveCards: vi.fn(), rescheduleEvent: h.reschedule, undoLastMove: h.undo }),
}));
vi.mock('../../../src/renderer/lib/stores/settings-calendar.svelte', () => ({
  getCalendarSettings: () => ({ weekStart: 7, showWeekNumbers: true }),
}));
vi.mock('../../../src/renderer/lib/stores/code-plugins.svelte', () => ({ codePluginsStore: { isOn: () => true, name: () => 'Calendar' } }));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';
import { parseObjectViewSpec } from '../../../src/renderer/lib/markdown/object-view-renderer';
import { autoLoadPluginFrames, pluginLoopback } from './plugin-loopback';

// The drawing measures its width with a ResizeObserver, which jsdom lacks.
if (!('ResizeObserver' in globalThis)) {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

function props(over: Record<string, unknown> = {}) {
  return {
    typeId: 'journal', layout: 'calendar' as const, sortColumn: null, sortDir: 'asc' as const, columns: null,
    revision: 0, onStateChange: vi.fn(), onOpenNote: vi.fn(), ...over,
  };
}

describe('calendar layout (#2701, #2702)', () => {
  // A dated type that isn't Event: Calendar is offered by having a date property, not by ancestry.
  const JOURNAL = {
    id: 'journal', label: 'Journal', classLocalName: 'Journal', icon: '📓', source: 'user' as const,
    properties: [{ name: 'published', type: 'date' as const }, { name: 'revised', type: 'datetime' as const }, { name: 'editor', type: 'text' as const }],
  };
  const DIARY = { id: 'diary', label: 'Diary', classLocalName: 'Diary', icon: '📔', parent: 'journal', source: 'user' as const, properties: [] };
  const ENTRIES = [
    { path: 'j1.md', title: 'Spring issue', values: { published: '2026-03-01', revised: null, editor: 'Ann' }, cover: null },
    { path: 'j2.md', title: 'Autumn issue', values: { published: '2026-10-01', revised: null, editor: 'Bo' }, cover: null },
  ];
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    pluginLoopback(h.loop, () => import('../../../plugins/calendar/src/App.svelte'));
    writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    h.list.mockResolvedValue({ types: [JOURNAL, DIARY], errors: [] });
    h.noteTypeMap.mockResolvedValue({});
    await objectTypesStore.refresh();
  });
  let stopAutoLoad = () => {};
  beforeEach(() => { stopAutoLoad = autoLoadPluginFrames(); });
  afterEach(() => { stopAutoLoad(); cleanup(); });
  const copied = async () => {
    await fireEvent.click(screen.getByText('Copy as markdown'));
    const md = writeText.mock.calls.at(-1)![0] as string;
    return { md, spec: parseObjectViewSpec(md.replace(/^```object-view\n/, '').replace(/\n```\n$/, '')) };
  };
  const drawn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-calendar-event]')].map((e) => e.dataset['notePath']);

  it('draws the month grid, placed by Date by, and writes the page back through onStateChange', async () => {
    h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
    const onStateChange = vi.fn();
    const { container } = render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-10', onStateChange }));
    await waitFor(() => expect(container.querySelector('[role="grid"]')).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Calendar' }).getAttribute('aria-selected')).toBe('true');
    expect(drawn(container)).toEqual(['j2.md']);
    expect(screen.getByRole('combobox', { name: 'Date by' })).toBeTruthy(); // published and revised
    await fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(onStateChange).toHaveBeenCalledWith({ month: '2026-09' });
  });

  it('an embed is read-only: it pages, but writes nothing back', async () => {
    h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
    const onStateChange = vi.fn();
    const { container } = render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-03', chromeless: true, onStateChange }));
    await waitFor(() => expect(drawn(container)).toEqual(['j1.md']));
    await fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(container.querySelector('.cal-title')!.textContent).toBe('April 2026');
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('Copy as markdown keeps the calendar, its month and dateBy, and omits the defaults', async () => {
    h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
    render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '-0043-03', dateBy: 'revised' }));
    await screen.findByRole('grid');
    expect((await copied()).spec).toMatchObject({ typeId: 'journal', layout: 'calendar', month: '-0043-03', dateBy: 'revised' });
    cleanup();
    render(TypeView, props({ typeId: 'journal', layout: 'calendar' }));
    await screen.findByRole('grid');
    const { md, spec } = await copied();
    expect(md).not.toContain('"month"');
    expect(md).not.toContain('"dateBy"');
    expect(spec).toMatchObject({ layout: 'calendar', month: null, mode: null, date: null, dateBy: null });
  });

  it('a dateBy that is not a date property of the type is dropped from the copy', async () => {
    h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
    render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-10', dateBy: 'editor' }));
    await screen.findByRole('grid');
    const { md, spec } = await copied();
    expect(spec).toMatchObject({ layout: 'calendar', month: '2026-10', dateBy: null });
    expect(md).not.toContain('editor');
  });

  it('a user subtype that inherits its date keeps its calendar and an inherited dateBy', async () => {
    h.instances.mockResolvedValue({ type: DIARY, instances: ENTRIES });
    const { container } = render(TypeView, props({ typeId: 'diary', layout: 'calendar', month: '2026-10', dateBy: 'published' }));
    await waitFor(() => expect(drawn(container)).toEqual(['j2.md']));
    expect((await copied()).spec).toMatchObject({ typeId: 'diary', layout: 'calendar', month: '2026-10', dateBy: 'published' });
  });

  it('sends mode and date to the plugin, takes them back from view.setState, and copies them (#2950)', async () => {
    h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
    const onStateChange = vi.fn();
    render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-10', mode: 'week', date: '2026-10-06', onStateChange }));
    await screen.findByRole('grid');
    await waitFor(() => expect(h.loop.views.at(-1)?.spec).toMatchObject({ month: '2026-10', mode: 'week', date: '2026-10-06' }));
    h.loop.host!.setViewState!({ mode: 'day', date: '2026-10-07', groupBy: 'nope' });
    expect(onStateChange).toHaveBeenLastCalledWith({ mode: 'day', date: '2026-10-07' }); // only the layout's own fields
    expect((await copied()).spec).toMatchObject({ month: '2026-10', mode: 'week', date: '2026-10-06' });
  });

  it('a saved week view opens on its week, and its switch writes back through onStateChange (#2951)', async () => {
    h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
    const onStateChange = vi.fn();
    const { container } = render(TypeView, props({ typeId: 'journal', layout: 'calendar', mode: 'week', date: '2026-09-30', onStateChange }));
    await waitFor(() => expect(container.querySelector('[role="grid"][data-week-start]')).toBeTruthy());
    expect(container.querySelector('.cal-title')!.textContent.replace(/\s+/g, ' ')).toBe('Week 40 · September 27 – October 3, 2026'); // the viewer's Sunday start, week numbers on
    expect(drawn(container)).toEqual(['j2.md']); // 1 October, all day
    await fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ mode: null, month: '2026-09' });
  });

  it('a mode or date the plugin sent malformed reads as the month grid and today (#2950)', async () => {
    h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
    render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-10', mode: 'month', date: '6 Oct' }));
    await screen.findByRole('grid');
    await waitFor(() => expect(h.loop.views.at(-1)?.spec).toMatchObject({ mode: null, date: null }));
    const { md } = await copied();
    expect(md).not.toContain('"mode"');
    expect(md).not.toContain('"date"');
  });

  describe("the plugin's reschedules are the host's (#2829)", () => {
    it('view.reschedule moves the note through the move store, and History says the Calendar did', async () => {
      h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
      render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-10' }));
      await waitFor(() => expect(h.loop.host?.reschedule).toBeTypeOf('function'));
      h.loop.host!.reschedule!('j2.md', 3);
      expect(h.reschedule).toHaveBeenCalledWith(
        { path: 'j2.md', title: 'Autumn issue' }, { start: 'published', end: null }, 3,
        { to: expect.any(String), back: expect.any(String) }, { cause: 'Moved by Calendar' },
      );
    });

    it("⌘Z is the calendar's own undo; the view says whether there is one; the week is the viewer's", async () => {
      h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
      render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-10' }));
      await waitFor(() => expect(h.loop.views.length).toBeGreaterThan(0));
      expect(h.loop.views.at(-1)).toMatchObject({ movable: true, canUndoMove: false, week: { start: 7, numbers: true } });
      h.loop.host!.undoMove!();
      expect(h.undo).toHaveBeenCalledWith('calendar', { cause: 'Moved by Calendar' });
    });

    it('an embed reschedules nothing and undoes nothing', async () => {
      h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
      render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-10', chromeless: true }));
      await waitFor(() => expect(h.loop.views.length).toBeGreaterThan(0));
      expect(h.loop.views.at(-1)).toMatchObject({ movable: false, readOnly: true });
      h.loop.host!.reschedule!('j2.md', 3);
      h.loop.host!.undoMove!();
      expect(h.reschedule).not.toHaveBeenCalled();
      expect(h.undo).not.toHaveBeenCalled();
    });
  });

  describe("Minerva's note menu on an event (#2929)", () => {
    const actions = () => ({ editProperties: vi.fn(), addTag: vi.fn(), removeTag: vi.fn(), clearProperty: vi.fn() });
    const event = (root: HTMLElement, path: string) => root.querySelector<HTMLElement>(`[data-plugin-loopback] [data-note-path="${path}"]`)!;
    const items = () => screen.getAllByRole('menuitem').map((i) => i.textContent.trim());

    it("in the panel: the note actions, and Move to date… starts the calendar's day picker", async () => {
      h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
      const noteActions = actions();
      const { container } = render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-10', noteActions }));
      await waitFor(() => expect(drawn(container)).toEqual(['j2.md']));
      await fireEvent.contextMenu(event(container, 'j2.md'), { clientX: 40, clientY: 50 });
      await screen.findByRole('menu');
      expect(items()).toEqual(['Move to date…', 'Add Tag…', 'Remove Tag▸', 'Set Property▸', 'Clear Property▸', 'Edit Properties…']);
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Add Tag…' }));
      expect(noteActions.addTag).toHaveBeenCalledWith(['j2.md']);

      await fireEvent.contextMenu(event(container, 'j2.md'));
      await fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to date…' }));
      await waitFor(() => expect(container.querySelector('[data-calendar-move-bar]')).toBeTruthy());
      expect(screen.queryByRole('menu')).toBeNull();
      const oct1 = container.querySelector<HTMLElement>('[role="gridcell"][aria-describedby]')!;
      await fireEvent.keyDown(oct1, { key: 'ArrowRight' });
      await waitFor(() => expect(document.activeElement).not.toBe(oct1));
      await fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
      expect(h.reschedule).toHaveBeenCalledWith(
        { path: 'j2.md', title: 'Autumn issue' }, { start: 'published', end: null }, 1,
        { to: expect.any(String), back: expect.any(String) }, { cause: 'Moved by Calendar' },
      );
    });

    it("an event that can't move keeps Move to date…, disabled, with the reason", async () => {
      const MONTH_ONLY = { path: 'j3.md', title: 'Some issue', values: { published: '2026-10', revised: null, editor: null }, cover: null };
      h.instances.mockResolvedValue({ type: JOURNAL, instances: [...ENTRIES, MONTH_ONLY] });
      const { container } = render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-10', noteActions: actions() }));
      await waitFor(() => expect(event(container, 'j3.md')).toBeTruthy()); // in the month band
      await fireEvent.contextMenu(event(container, 'j3.md'));
      const move = await screen.findByRole('menuitem', { name: 'Move to date…' });
      expect(move.getAttribute('aria-disabled')).toBe('true');
      const reason = document.getElementById(move.getAttribute('aria-describedby')!)!;
      expect(reason.textContent).toBe('2026-10 has no day to move; open it to edit.');
      await fireEvent.click(move);
      expect(screen.getByRole('menu')).toBeTruthy(); // stays open, having said why
      expect(container.querySelector('[data-calendar-move-bar]')).toBeNull();
    });

    it('an embed gets the note actions but no Move to date…', async () => {
      h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
      const { container } = render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-10', chromeless: true, noteActions: actions() }));
      await waitFor(() => expect(drawn(container)).toEqual(['j2.md']));
      await fireEvent.contextMenu(event(container, 'j2.md'));
      await screen.findByRole('menu');
      expect(items()).toEqual(['Add Tag…', 'Remove Tag▸', 'Set Property▸', 'Clear Property▸', 'Edit Properties…']);
    });

    it('without note actions (an export, or a host that offers none) a right-click opens nothing', async () => {
      h.instances.mockResolvedValue({ type: JOURNAL, instances: ENTRIES });
      const { container } = render(TypeView, props({ typeId: 'journal', layout: 'calendar', month: '2026-10' }));
      await waitFor(() => expect(drawn(container)).toEqual(['j2.md']));
      await fireEvent.contextMenu(event(container, 'j2.md'));
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });
});
