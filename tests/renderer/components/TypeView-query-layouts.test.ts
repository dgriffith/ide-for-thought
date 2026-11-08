/**
 * @vitest-environment jsdom
 *
 * A query view's layouts and rows (#2946): the layouts offered follow the
 * inferred columns; one the data no longer supports shows the table, saying
 * why; a row that names no note draws but never opens, selects or gets the
 * note menu; card layouts draw one card per note while the table keeps every
 * row; a board groups by an inferred enum and doesn't move. A rows source
 * stands in for a query's (TypeView can't tell them apart: no typeId).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/svelte';
import { kanbanHostState, openBoard } from './kanban-host';

const { plugin } = vi.hoisted(() => ({ plugin: {} as import('./kanban-host').KanbanHostState }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    types: { instances: vi.fn(), list: async () => ({ types: [], errors: [] }), noteTypeMap: async () => ({}) },
    export: { csv: vi.fn() }, app: { getSystemLocale: async () => 'en-GB' },
  },
}));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: (...a: unknown[]) => plugin.connect(...a) }));
vi.mock('../../../src/renderer/lib/stores/code-plugins.svelte', () => ({ codePluginsStore: { isOn: () => true, name: () => 'Kanban' } }));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { rowsSource } from '../../../src/renderer/lib/components/type-view/view-source';
import { toViewRows } from '../../../src/shared/views/view-rows';
import type { PropertyDef, TypeInfo } from '../../../src/shared/objects/type-def';

const schema = (properties: PropertyDef[]): TypeInfo => ({ id: 'query:test', label: 'Query view', classLocalName: '', source: 'user', properties });
const RICH = schema([
  { name: 'status', type: 'enum', options: ['todo', 'done'] },
  { name: 'due', type: 'date' },
  { name: 'where', type: 'geo' },
]);
const ROWS = toViewRows([
  { path: 'a.md', title: 'Alpha', values: { status: 'todo', due: '2026-10-07', where: '50.08,14.42' } },
  { path: 'a.md', title: 'Alpha', values: { status: 'done', due: '2026-10-07', where: '50.08,14.42' } },
  { path: 'b.md', title: 'Beta', values: { status: 'done', due: '2026-10-09', where: '48.2,16.37' } },
  { path: null, title: 'A loose row', values: { status: 'todo', due: '2026-10-08', where: null } },
]);

const actions = () => ({ editProperties: vi.fn(), addTag: vi.fn(), removeTag: vi.fn(), clearProperty: vi.fn() });
function props(over: Record<string, unknown> = {}) {
  return {
    source: rowsSource('test:q', { schema: RICH, rows: ROWS }),
    layout: 'table' as const, sortColumn: null, sortDir: 'asc' as const, columns: null, revision: 0,
    onStateChange: vi.fn(), onOpenNote: vi.fn(), noteActions: actions(),
    ...over,
  };
}
const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent.trim());

beforeEach(() => { kanbanHostState(plugin); });
afterEach(() => cleanup());

describe('layouts follow the columns (#2946)', () => {
  it('a geo, an enum and a date column offer every layout; text alone only table, list and gallery', async () => {
    render(TypeView, props());
    await screen.findByText('Query view');
    expect(tabs()).toEqual(['List', 'Table', 'Gallery', 'Map', 'Kanban', 'Timeline', 'Calendar']);
    cleanup();
    render(TypeView, props({ source: rowsSource('test:t', { schema: schema([{ name: 'note', type: 'text' }]), rows: [] }) }));
    await screen.findByText('Query view');
    expect(tabs()).toEqual(['List', 'Table', 'Gallery']);
  });

  it('a layout the data no longer supports shows the table, saying why', async () => {
    const { container } = render(TypeView, props({ layout: 'map', source: rowsSource('test:t', { schema: schema([{ name: 'status', type: 'text' }]), rows: ROWS }) }));
    await waitFor(() => expect(container.querySelector('table')).toBeTruthy());
    expect(screen.getByText("This query no longer has a location column, so it's shown as a table.")).toBeTruthy();
  });
});

describe('rows with no note, and one card per note (#2946)', () => {
  it('the table keeps every row; the row with no note draws, unlinked, and doesn\'t open, select or menu', async () => {
    const onOpenNote = vi.fn();
    const { container } = render(TypeView, props({ onOpenNote }));
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(4));
    const loose = [...container.querySelectorAll<HTMLElement>('tbody tr')].find((tr) => tr.textContent.includes('A loose row'))!;
    expect(loose.hasAttribute('data-note-path')).toBe(false);
    expect(loose.hasAttribute('title')).toBe(false);
    await fireEvent.click(loose);
    await fireEvent.click(loose, { metaKey: true });
    expect(onOpenNote).not.toHaveBeenCalled();
    expect(loose.classList.contains('selected')).toBe(false);
    await fireEvent.contextMenu(loose);
    expect(document.querySelector('.tv-row-menu, [role="menu"]')).toBeNull();
    // A note's row still opens.
    await fireEvent.click([...container.querySelectorAll<HTMLElement>('tbody tr')].find((tr) => tr.textContent.includes('Beta'))!);
    expect(onOpenNote).toHaveBeenCalledWith('b.md');
  });

  it('a gallery is one card per note, its repeated column joined', async () => {
    const { container } = render(TypeView, props({ layout: 'gallery' }));
    await waitFor(() => expect(container.querySelectorAll('.tv-card')).toHaveLength(3));
    expect([...container.querySelectorAll('.tv-card')].map((c) => c.getAttribute('data-note-path'))).toEqual(['a.md', 'b.md', null]);
  });

  it('a board groups by the inferred enum, one card per note, and doesn\'t move; a loose row is drawn but out of scope', async () => {
    const { container } = render(TypeView, props({ layout: 'kanban' }));
    const b = await openBoard(container, plugin);
    expect(b.state()).toMatchObject({ groupProperty: 'status', movable: false });
    expect(b.state().instances.map((i) => i.path)).toEqual(['a.md', 'b.md', '#row-3']);
    expect(b.state().instances[0]!.values['status']).toBe('todo, done');
    const scope = plugin.connect.mock.calls.at(-1)![2] as string[];
    expect(scope).toEqual(expect.arrayContaining(['a.md', 'b.md']));
    expect(scope).not.toContain('#row-3');
  });
});

describe('a timeline of a result that names no notes (#2946)', () => {
  it('draws every row, and a click on one opens and selects nothing', async () => {
    const loose = toViewRows([
      { path: null, title: 'Q1 close', values: { due: '2026-03-31' } },
      { path: null, title: 'Q2 close', values: { due: '2026-06-30' } },
    ]);
    const onOpenNote = vi.fn();
    const { container } = render(TypeView, props({ layout: 'timeline', onOpenNote, source: rowsSource('test:sql', { schema: schema([{ name: 'due', type: 'date' }]), rows: loose }) }));
    const frame = await waitFor(() => {
      const f = container.querySelector<HTMLIFrameElement>('[data-plugin-layout="timeline"] iframe');
      expect(f).not.toBeNull();
      return f!;
    });
    await fireEvent.load(frame);
    await waitFor(() => expect(plugin.sendView).toHaveBeenCalled());
    const view = plugin.sendView.mock.calls.at(-1)![0] as import('../../../src/shared/plugins/api').PluginViewState;
    expect(view.instances.map((i) => i.title)).toEqual(['Q1 close', 'Q2 close']);
    expect(plugin.connect.mock.calls.at(-1)![2]).toEqual([]); // nothing in scope
    plugin.host!.viewClick!('#row-0', { meta: false, ctrl: false, shift: false });
    plugin.host!.viewClick!('#row-1', { meta: true, ctrl: false, shift: false });
    expect(onOpenNote).not.toHaveBeenCalled();
    expect(view.selected).toEqual([]);
  });
});
