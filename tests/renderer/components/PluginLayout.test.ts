/**
 * @vitest-environment jsdom
 *
 * The View API's host (#2828): a type view becomes the plugin's `view`
 * event, its notes the session's scope; the plugin's `view.setState` comes
 * back as the layout's own spec fields only, and not at all when read-only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  host: null as null | {
    setViewState?(p: Record<string, unknown>): void;
    showNoteMenu?(paths: string[], x: number, y: number, opts: { target: boolean; label: string | null }): void;
    previewNote?(path: string, rect: object, via: string): void;
    exportHtml?(requestId: string, html: string): void;
    viewClick?(path: string, mods: { meta: boolean; ctrl: boolean; shift: boolean }): void;
    selectAll?(): void;
    clearSelection?(): void;
  },
  sendView: vi.fn(async () => {}),
  requestExport: vi.fn(async () => {}),
}));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: h.connect }));
vi.mock('../../../src/renderer/lib/components/note-hover/app-fetcher', () => ({
  appNotePreviewFetcher: () => async (target: string) => ({ path: target, title: `Title of ${target}`, snippet: 'Text.' }),
}));

import PluginLayout from '../../../src/renderer/lib/components/plugins/PluginLayout.svelte';
import type { LayoutView } from '../../../src/renderer/lib/components/type-view/layout-view';

function fakeView(over: Partial<LayoutView> = {}): LayoutView {
  const rows = [
    { path: 'a.md', title: 'Alpha', values: { status: 'todo' }, cover: null, tags: ['x'] },
    { path: 'b.md', title: 'Bravo', values: { status: 'done' }, cover: null },
  ];
  return {
    type: { id: 'task', label: 'Task', classLocalName: 'Task', properties: [], icon: '✅' },
    properties: [{ name: 'status', type: 'enum', options: ['todo', 'done'] }],
    visible: null, instances: rows, sorted: [rows[1]!, rows[0]!], sortColumn: 'title', sortDir: 'desc',
    readOnly: false, exportMode: false, onStateChange: vi.fn(), openRowMenu: vi.fn(),
    display: (_p: unknown, v: string | null) => (v ? v.toUpperCase() : ''), rowType: () => null, pluginExport: undefined,
    refPath: () => null, isSelected: (p: string) => p === 'a.md', selectable: true, rowMenu: true, group: null,
    spec: { groupBy: 'status', columnOrder: [], showEmptyColumns: true }, board: [], canUndoMove: false, lastMove: null, filters: [],
    onMoveCard: undefined, onUndoMove: undefined, onMoveColumn: undefined,
    onRowClick: vi.fn(), selectAll: vi.fn(), clearSelection: vi.fn(),
    ...over,
  } as unknown as LayoutView;
}

beforeEach(() => {
  h.sendView.mockClear();
  h.requestExport.mockClear();
  h.connect.mockReset();
  h.connect.mockImplementation(async (_f: unknown, _id: string, _s: string[], host: typeof h.host) => {
    h.host = host;
    return { sessionId: 's', setScope: vi.fn(async () => {}), sendTheme: vi.fn(async () => {}), drop: vi.fn(), sendView: h.sendView, requestExport: h.requestExport, sendPreview: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  });
});
afterEach(() => cleanup());

async function mounted(view = fakeView(), layout: 'kanban' | 'timeline' = 'kanban') {
  const r = render(PluginLayout, { view, layout, pluginId: layout });
  await fireEvent.load(r.container.querySelector('iframe')!);
  await waitFor(() => expect(h.sendView).toHaveBeenCalled());
  return { ...r, view };
}

describe('PluginLayout (#2828)', () => {
  it("names the frame after the layout and type, and scopes it to the view's notes in its order", async () => {
    const { container } = await mounted();
    expect(container.querySelector('iframe')!.getAttribute('title')).toBe('Kanban of Task');
    expect(h.connect).toHaveBeenCalledWith(expect.anything(), 'kanban', ['b.md', 'a.md'], expect.anything());
  });

  it('sends the view as plain data', async () => {
    await mounted();
    expect(h.sendView.mock.calls.at(-1)![0]).toEqual({
      layout: 'kanban',
      type: { id: 'task', label: 'Task', icon: '✅' },
      properties: [{ name: 'status', type: 'enum', options: ['todo', 'done'] }],
      visible: null,
      instances: [
        { path: 'b.md', title: 'Bravo', values: { status: 'done' }, fields: [{ name: 'status', label: 'status', text: 'DONE' }] },
        { path: 'a.md', title: 'Alpha', values: { status: 'todo' }, tags: ['x'], fields: [{ name: 'status', label: 'status', text: 'TODO' }] },
      ],
      sortColumn: 'title', sortDir: 'desc',
      spec: { groupBy: 'status', columnOrder: [], showEmptyColumns: true },
      filters: [],
      readOnly: false, exportMode: false,
      selected: ['a.md'], selectable: true, rowMenu: true,
      groupProperty: null, groups: [], movable: false, canUndoMove: false, lastMove: null,
    });
  });

  it('sends it again when the view changes', async () => {
    const r = await mounted();
    const calls = h.sendView.mock.calls.length;
    await r.rerender({ view: fakeView({ sortDir: 'asc', spec: { groupBy: 'status', columnOrder: ['done'] } }), layout: 'kanban', pluginId: 'kanban' });
    await waitFor(() => expect(h.sendView.mock.calls.length).toBeGreaterThan(calls));
    expect(h.sendView.mock.calls.at(-1)![0]).toMatchObject({ sortDir: 'asc', spec: { columnOrder: ['done'] } });
  });

  it("keeps only the layout's own spec fields from view.setState", async () => {
    const { view } = await mounted();
    h.host!.setViewState!({ columnOrder: ['done', 'todo'], layout: 'table', folder: '/', filters: [] });
    expect(view.onStateChange).toHaveBeenCalledTimes(1);
    expect(view.onStateChange).toHaveBeenCalledWith({ columnOrder: ['done', 'todo'] });
    h.host!.setViewState!({ layout: 'table' });
    expect(view.onStateChange).toHaveBeenCalledTimes(1);
  });

  it('changes nothing in an embed or export', async () => {
    const { view } = await mounted(fakeView({ readOnly: true }));
    h.host!.setViewState!({ columnOrder: ['done'] });
    expect(view.onStateChange).not.toHaveBeenCalled();
  });
});

describe('the kit gaps, for a layout (#2828, part B)', () => {
  it("opens the view's own row menu for the notes the plugin names", async () => {
    const { view, container } = await mounted();
    container.querySelector('iframe')!.getBoundingClientRect = () => ({ left: 10, top: 20, right: 0, bottom: 0, width: 0, height: 0, x: 10, y: 20, toJSON: () => ({}) });
    h.host!.showNoteMenu!(['a.md'], 5, 6, { target: false, label: null });
    expect(view.openRowMenu).toHaveBeenCalledWith(['a.md'], 15, 26, { target: false, label: null });
  });

  it('asks for the export after sending the view, and draws the answer sanitized, then says so', async () => {
    const onRendered = vi.fn();
    const view = fakeView({ exportMode: true, readOnly: true, pluginExport: { onRendered, onFailed: vi.fn() } });
    const { container } = await mounted(view);
    await waitFor(() => expect(h.requestExport).toHaveBeenCalledTimes(1));
    const requestId = h.requestExport.mock.calls[0]![0] as string;
    expect(h.sendView.mock.invocationCallOrder[0]).toBeLessThan(h.requestExport.mock.invocationCallOrder[0]!);

    h.host!.exportHtml!('not-the-request', '<p>wrong</p>');
    expect(container.textContent).not.toContain('wrong');

    h.host!.exportHtml!(requestId, '<section style="color: var(--text)"><h3>Done</h3><p data-note-path="a.md" onclick="steal()">Alpha</p>'
      + '<img src="https://evil/beacon.png"><script>steal()</script></section>');
    await waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1));
    const out = container.querySelector<HTMLElement>('.plugin-export')!;
    expect(out).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(out.innerHTML).toContain('data-note-path="a.md"');
    expect(out.innerHTML).not.toMatch(/onclick|<img|<script|evil/);
  });

  it('asks for nothing when it is not an export', async () => {
    await mounted();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.requestExport).not.toHaveBeenCalled();
  });
});

describe('prepared cards and the host\'s selection (#2828, C1)', () => {
  const OWNER = { name: 'owner', type: 'link-to-type', label: 'Owner' };
  const STATUS = { name: 'status', type: 'enum', options: ['todo', 'done'] };
  const withLinks = () => fakeView({
    properties: [STATUS, OWNER] as LayoutView['properties'],
    group: STATUS as LayoutView['group'],
    sorted: [{ path: 'a.md', title: 'Alpha', values: { status: 'todo', owner: 'Ann' }, cover: null }] as LayoutView['sorted'],
    refPath: (p: { name: string }, v: string | null) => (p.name === 'owner' && v ? `people/${v.toLowerCase()}.md` : null),
    rowType: () => ({ id: 'bug', label: 'Bug', classLocalName: 'Bug', properties: [], icon: '🐞', color: '#c00' }) as never,
  });

  it("draws the app's card: fields as display text, a board's grouping property left off, a link's note, its own icon", async () => {
    await mounted(withLinks());
    const inst = h.sendView.mock.calls.at(-1)![0].instances[0];
    expect(inst.fields).toEqual([{ name: 'owner', label: 'Owner', text: 'ANN', ref: 'people/ann.md' }]);
    expect(inst.icon).toEqual({ glyph: '🐞', label: 'Bug', color: '#c00' });
  });

  it('scopes the frame to the notes and the notes their links name', async () => {
    await mounted(withLinks());
    expect(h.connect.mock.calls.at(-1)![2]).toEqual(['a.md', 'people/ann.md']);
  });

  it("hands a click, ⌘A and Escape to the view's own selection", async () => {
    const { view } = await mounted();
    h.host!.viewClick!('a.md', { meta: true, ctrl: false, shift: false });
    const [e, path] = (view.onRowClick as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe('a.md');
    expect((e as MouseEvent).metaKey).toBe(true);
    h.host!.selectAll!();
    h.host!.clearSelection!();
    expect(view.selectAll).toHaveBeenCalledTimes(1);
    expect(view.clearSelection).toHaveBeenCalledTimes(1);
  });
});

describe("a card's hover preview (#2710, #2828)", () => {
  it("shows the card's fields in the preview's strip — a board's grouping property left out, as on the card", async () => {
    const STATUS = { name: 'status', type: 'enum', options: ['todo', 'done'] };
    const OWNER = { name: 'owner', type: 'text', label: 'Owner' };
    const rows = [{ path: 'a.md', title: 'Alpha', values: { status: 'todo', owner: 'Ann' }, cover: null }];
    await mounted(fakeView({
      properties: [STATUS, OWNER] as LayoutView['properties'],
      group: STATUS as LayoutView['group'],
      instances: rows,
      sorted: rows,
    }));
    (h.host as unknown as { previewNote(p: string, r: object, v: string): void }).previewNote('a.md', { x: 0, y: 0, width: 10, height: 10 }, 'focus');
    const strip = await vi.waitFor(() => {
      const el = document.querySelector('.note-hover-preview .nhp-fields');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(strip.textContent).toContain('Owner ANN'); // the fake view's display upper-cases
    expect(strip.textContent).not.toMatch(/todo/i);
  });

  it("draws the plugin's extra lines in the preview, and leaves off the fields it names (#2829)", async () => {
    const DATE = { name: 'date', type: 'datetime' };
    const PLACE = { name: 'place', type: 'text', label: 'Place' };
    const rows = [{ path: 'a.md', title: 'Moon landing', values: { date: '1969-07-20', place: 'Sea of Tranquility' }, cover: null }];
    await mounted(fakeView({ properties: [DATE, PLACE] as LayoutView['properties'], instances: rows, sorted: rows }), 'timeline');
    (h.host as unknown as { previewNote(p: string, r: object, v: string, o: object): void })
      .previewNote('a.md', { x: 0, y: 0, width: 10, height: 10 }, 'focus', { extra: ['20 Jul 1969 · approximate', '⚠ End date ignored'], omit: ['date'] });
    const tip = await vi.waitFor(() => {
      const el = document.querySelector('.note-hover-preview');
      expect(el?.querySelector('.nhp-fields')).toBeTruthy();
      return el!;
    });
    expect([...tip.querySelectorAll('.nhp-extra > span')].map((l) => l.textContent)).toEqual(['20 Jul 1969 · approximate', '⚠ End date ignored']);
    expect(tip.querySelector('.nhp-fields')!.textContent).toContain('Place SEA OF TRANQUILITY');
    expect(tip.querySelector('.nhp-fields')!.textContent).not.toContain('1969-07-20');
  });
});
