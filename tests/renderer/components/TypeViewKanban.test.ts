/**
 * @vitest-environment jsdom
 *
 * The Kanban board in a type view (#2602), the host's half: columns in the
 * enum's order with counts, No value only when needed, a values filter
 * narrowing the columns, folder scope, the cards' fields, a click opening its
 * note, the Group by picker, and Kanban offered only for a type with an enum
 * property. Since #2828 the board is drawn by the Kanban plugin in a plugin
 * frame, so this reads the view TypeView sends it (`kanban-host.ts`); the
 * board's own drawing and keyboard are tests/plugins/kanban/Board.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/svelte';
import { kanbanHostState, openBoard } from './kanban-host';

const { instancesMock, listMock, noteTypeMapMock, plugin } = vi.hoisted(() => ({
  instancesMock: vi.fn(), listMock: vi.fn(), noteTypeMapMock: vi.fn(),
  plugin: {} as import('./kanban-host').KanbanHostState,
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock } },
}));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: (...a: unknown[]) => plugin.connect(...a) }));
vi.mock('../../../src/renderer/lib/stores/core-plugins.svelte', () => ({ corePluginsStore: { isOn: () => true, name: () => 'Kanban' } }));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

const PROJECT = {
  id: 'project',
  label: 'Project',
  classLocalName: 'Project',
  icon: '🚀',
  source: 'stock' as const,
  properties: [
    { name: 'status', type: 'enum' as const, options: ['active', 'paused', 'done', 'abandoned'] },
    { name: 'priority', type: 'enum' as const, label: 'Priority', options: ['low', 'high'] },
    { name: 'owner', type: 'text' as const, label: 'Owner' },
  ],
};
const BOOK = {
  id: 'book', label: 'Book', classLocalName: 'Book', icon: '📖', source: 'stock' as const,
  properties: [{ name: 'author', type: 'text' as const }],
};

const row = (path: string, title: string, values: Record<string, string | null>) =>
  ({ path, title, values: { status: null, priority: null, owner: null, ...values }, cover: null });

const FILED = [
  row('a.md', 'Alpha', { status: 'active', owner: 'Ann', priority: 'high' }),
  row('b.md', 'Bravo', { status: 'done', owner: 'Bo' }),
  row('c.md', 'Charlie', { status: 'active' }),
  row('d.md', 'Delta', { status: 'paused', priority: 'low' }),
];
const WITH_UNFILED = [...FILED, row('e.md', 'Echo', {})];

function props(over: Record<string, unknown> = {}) {
  return {
    typeId: 'project',
    layout: 'kanban' as const,
    sortColumn: null,
    sortDir: 'asc' as const,
    columns: null,
    revision: 0,
    onStateChange: vi.fn(),
    onOpenNote: vi.fn(),
    ...over,
  };
}

beforeEach(async () => {
  kanbanHostState(plugin);
  listMock.mockResolvedValue({ types: [PROJECT, BOOK], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  await objectTypesStore.refresh();
  instancesMock.mockResolvedValue({ type: PROJECT, instances: FILED });
});
afterEach(() => { cleanup(); instancesMock.mockReset(); });

describe('Kanban board (#2602) — what the host sends the plugin', () => {
  it('a column per option in declared order, each with its count — empty options too', async () => {
    const { container } = render(TypeView, props());
    const b = await openBoard(container, plugin);
    expect(b.columns()).toEqual([['active', '2'], ['paused', '1'], ['done', '1'], ['abandoned', '0']]);
    expect(b.titles('active')).toEqual(['Alpha', 'Charlie']);
    expect(b.titles('paused')).toEqual(['Delta']);
  });

  it('No value only when some note has no value, and last', async () => {
    const first = render(TypeView, props());
    expect((await openBoard(first.container, plugin)).columns().map(([l]) => l)).not.toContain('No value');
    first.unmount();
    kanbanHostState(plugin);
    instancesMock.mockResolvedValue({ type: PROJECT, instances: WITH_UNFILED });
    const second = render(TypeView, props());
    expect((await openBoard(second.container, plugin)).columns().at(-1)).toEqual(['No value', '1']);
  });

  it('a value nobody declared (hand-edited frontmatter) gets its own column, not hidden', async () => {
    instancesMock.mockResolvedValue({ type: PROJECT, instances: [...FILED, row('x.md', 'Xray', { status: 'blocked' })] });
    const { container } = render(TypeView, props());
    const b = await openBoard(container, plugin);
    expect(b.columns().map(([l]) => l)).toEqual(['active', 'paused', 'done', 'abandoned', 'blocked']);
    expect(b.state().groups.at(-1)!.kind).toBe('off-list');
  });

  it('cards follow the view sort within a column', async () => {
    const { container } = render(TypeView, props({ sortColumn: '__title', sortDir: 'desc' }));
    expect((await openBoard(container, plugin)).titles('active')).toEqual(['Charlie', 'Alpha']);
  });

  it('a values filter on the grouping property shows only those columns', async () => {
    instancesMock.mockResolvedValue({ type: PROJECT, instances: WITH_UNFILED });
    const { container } = render(TypeView, props({ filters: [{ property: 'status', values: ['active', 'done'] }] }));
    expect((await openBoard(container, plugin)).columns()).toEqual([['active', '2'], ['done', '1']]);
  });

  it('a filter on another property narrows the cards but keeps every column', async () => {
    const { container } = render(TypeView, props({ filters: [{ property: 'priority', values: ['high'] }] }));
    expect((await openBoard(container, plugin)).columns()).toEqual([['active', '1'], ['paused', '0'], ['done', '0'], ['abandoned', '0']]);
  });

  it('folder scope applies to the board, and to what the plugin may reach', async () => {
    instancesMock.mockResolvedValue({ type: PROJECT, instances: [row('work/a.md', 'Alpha', { status: 'active' }), row('home/b.md', 'Bravo', { status: 'done' })] });
    const { container } = render(TypeView, props({ folder: 'work' }));
    const b = await openBoard(container, plugin);
    expect(b.state().instances.map((i) => i.path)).toEqual(['work/a.md']);
    expect(b.columns()[0]).toEqual(['active', '1']);
    expect(plugin.connect.mock.calls.at(-1)![2]).toEqual(['work/a.md']);
  });

  it("a card is the app's: its icon, and properties — not the one the column already says", async () => {
    const { container } = render(TypeView, props());
    const b = await openBoard(container, plugin);
    expect(b.state().instances.find((i) => i.path === 'a.md')!.icon).toEqual({ glyph: '🚀', label: 'Project' });
    expect(b.fields('a.md')).toEqual(['Priority high', 'Owner Ann']);
  });

  it("the view's visible properties choose the card's fields", async () => {
    const { container } = render(TypeView, props({ columns: ['status', 'owner'] }));
    expect((await openBoard(container, plugin)).fields('a.md')).toEqual(['Owner Ann']);
  });

  it("a click on a card, through the view's selection, opens its note", async () => {
    const onOpenNote = vi.fn();
    const { container } = render(TypeView, props({ onOpenNote }));
    const b = await openBoard(container, plugin);
    b.host().viewClick!('d.md', { meta: false, ctrl: false, shift: false });
    expect(onOpenNote).toHaveBeenCalledWith('d.md');
  });

  it('groups by the picked enum property, and the picker lists only enum properties', async () => {
    const onStateChange = vi.fn();
    const { container } = render(TypeView, props({ groupBy: 'priority', onStateChange }));
    const b = await openBoard(container, plugin);
    expect(b.columns()).toEqual([['low', '1'], ['high', '1'], ['No value', '2']]);
    expect(b.state().groupProperty).toBe('priority');
    const picker = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Group by' });
    expect(picker.value).toBe('priority');
    expect([...picker.options].map((o) => o.textContent)).toEqual(['status', 'Priority']);
    await fireEvent.change(picker, { target: { value: 'status' } });
    // A new grouping starts from its own enum order (#2614).
    expect(onStateChange).toHaveBeenCalledWith({ groupBy: 'status', columnOrder: [] });
  });

  it('a groupBy that is not an enum of the type falls back to the first enum', async () => {
    const { container } = render(TypeView, props({ groupBy: 'owner' }));
    const b = await openBoard(container, plugin);
    expect(b.columns()[0]![0]).toBe('active');
    expect((screen.getByRole<HTMLSelectElement>('combobox', { name: 'Group by' })).value).toBe('status');
  });

  it('shows no Group by picker when the type has only one enum property', async () => {
    const SINGLE = { ...PROJECT, properties: PROJECT.properties.filter((p) => p.name !== 'priority') };
    instancesMock.mockResolvedValue({ type: SINGLE, instances: FILED });
    const { container } = render(TypeView, props());
    await openBoard(container, plugin);
    expect(screen.queryByRole('combobox', { name: 'Group by' })).toBeNull();
  });

  it('shows no Group by picker outside the Kanban layout', async () => {
    render(TypeView, props({ layout: 'list' }));
    await screen.findByText('Alpha');
    expect(screen.queryByRole('combobox', { name: 'Group by' })).toBeNull();
  });

  describe('the layout switcher', () => {
    it('offers Kanban for a type with an enum property, and switching goes through onStateChange', async () => {
      const onStateChange = vi.fn();
      render(TypeView, props({ layout: 'list', onStateChange }));
      await screen.findByText('Alpha');
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['List', 'Table', 'Gallery', 'Kanban']);
      await fireEvent.click(screen.getByRole('tab', { name: 'Kanban' }));
      expect(onStateChange).toHaveBeenCalledWith({ layout: 'kanban' });
    });

    it('does not offer Kanban for a type with no enum property', async () => {
      instancesMock.mockResolvedValue({ type: BOOK, instances: [{ path: 'Dune.md', title: 'Dune', values: { author: 'Herbert' }, cover: null }] });
      render(TypeView, props({ typeId: 'book', layout: 'list' }));
      await screen.findByText('Dune');
      expect(screen.queryByRole('tab', { name: 'Kanban' })).toBeNull();
    });

    it('a kanban spec for a type with no enum property tells the plugin there is nothing to group by', async () => {
      instancesMock.mockResolvedValue({ type: BOOK, instances: [{ path: 'Dune.md', title: 'Dune', values: { author: 'Herbert' }, cover: null }] });
      const { container } = render(TypeView, props({ typeId: 'book' }));
      const b = await openBoard(container, plugin);
      expect(b.state().groupProperty).toBeNull();
      expect(b.state().groups).toEqual([]);
    });
  });

  it('in an embed (chromeless): read-only, no toolbar, nothing to move', async () => {
    const { container } = render(TypeView, props({ chromeless: true }));
    const b = await openBoard(container, plugin);
    expect(b.columns()).toHaveLength(4);
    expect(b.state()).toMatchObject({ readOnly: true, movable: false, selectable: false });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Group by' })).toBeNull();
  });
});
