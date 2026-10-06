/**
 * @vitest-environment happy-dom
 *
 * The Kanban board in a type view (#2602): columns in the enum's order with
 * counts, No value only when needed, a values filter narrowing the columns,
 * cards that open their note, keyboard navigation (a roving tabindex), the
 * Group by picker, and Kanban offered only for a type with an enum property.
 * Rendered through `TypeView`, which owns the switcher and the wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, within } from '@testing-library/svelte';

const { instancesMock, listMock, noteTypeMapMock } = vi.hoisted(() => ({
  instancesMock: vi.fn(), listMock: vi.fn(), noteTypeMapMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock } },
}));

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

/** Each column's heading text and count, in on-screen order. */
function columns(container: HTMLElement): [string, string][] {
  return [...container.querySelectorAll('.kb-column')].map((c) => [
    c.querySelector('.kb-col-label')!.textContent,
    c.querySelector('.kb-col-count')!.textContent,
  ]);
}
const cardTitles = (list: HTMLElement) => within(list).queryAllByRole('listitem').map((li) => li.querySelector('.kb-card-name')!.textContent);
const card = (container: HTMLElement, path: string) => container.querySelector<HTMLElement>(`[data-kanban-card][data-note-path="${path}"]`)!;

beforeEach(async () => {
  listMock.mockResolvedValue({ types: [PROJECT, BOOK], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  await objectTypesStore.refresh();
  instancesMock.mockResolvedValue({ type: PROJECT, instances: FILED });
});
afterEach(() => { cleanup(); instancesMock.mockReset(); });

describe('Kanban board (#2602)', () => {
  it('draws a column per option in declared order, each with its count — empty options too', async () => {
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    expect(columns(container)).toEqual([['active', '2'], ['paused', '1'], ['done', '1'], ['abandoned', '0']]);
  });

  it('each column is a list labelled with its heading and count, and the cards are its items', async () => {
    render(TypeView, props());
    await screen.findByText('Alpha');
    const active = screen.getByRole('list', { name: 'active, 2 cards' });
    expect(cardTitles(active)).toEqual(['Alpha', 'Charlie']);
    expect(cardTitles(screen.getByRole('list', { name: 'paused, 1 card' }))).toEqual(['Delta']);
    expect(cardTitles(screen.getByRole('list', { name: 'abandoned, 0 cards' }))).toEqual([]);
  });

  it('shows No value only when some note has no value, and last', async () => {
    const { container, unmount } = render(TypeView, props());
    await screen.findByText('Alpha');
    expect(columns(container).map(([l]) => l)).not.toContain('No value');
    unmount();

    instancesMock.mockResolvedValue({ type: PROJECT, instances: WITH_UNFILED });
    const second = render(TypeView, props());
    await screen.findByText('Echo');
    expect(columns(second.container).at(-1)).toEqual(['No value', '1']);
  });

  it('a value nobody declared (hand-edited frontmatter) gets its own column, not hidden', async () => {
    instancesMock.mockResolvedValue({ type: PROJECT, instances: [...FILED, row('x.md', 'Xray', { status: 'blocked' })] });
    const { container } = render(TypeView, props());
    await screen.findByText('Xray');
    expect(columns(container).map(([l]) => l)).toEqual(['active', 'paused', 'done', 'abandoned', 'blocked']);
  });

  it('cards follow the view sort within a column', async () => {
    const { container } = render(TypeView, props({ sortColumn: '__title', sortDir: 'desc' }));
    await screen.findByText('Alpha');
    expect(cardTitles(container.querySelector<HTMLElement>('[data-column-value="active"] ul')!)).toEqual(['Charlie', 'Alpha']);
  });

  it('a values filter on the grouping property shows only those columns', async () => {
    instancesMock.mockResolvedValue({ type: PROJECT, instances: WITH_UNFILED });
    const { container } = render(TypeView, props({ filters: [{ property: 'status', values: ['active', 'done'] }] }));
    await screen.findByText('Alpha');
    expect(columns(container)).toEqual([['active', '2'], ['done', '1']]);
  });

  it('a filter on another property narrows the cards but keeps every column', async () => {
    const { container } = render(TypeView, props({ filters: [{ property: 'priority', values: ['high'] }] }));
    await screen.findByText('Alpha');
    expect(columns(container)).toEqual([['active', '1'], ['paused', '0'], ['done', '0'], ['abandoned', '0']]);
  });

  it('folder scope applies to the board', async () => {
    instancesMock.mockResolvedValue({ type: PROJECT, instances: [row('work/a.md', 'Alpha', { status: 'active' }), row('home/b.md', 'Bravo', { status: 'done' })] });
    const { container } = render(TypeView, props({ folder: 'work' }));
    await screen.findByText('Alpha');
    expect(screen.queryByText('Bravo')).toBeNull();
    expect(columns(container)[0]).toEqual(['active', '1']);
  });

  it('a card shows its icon, title and properties — not the one the column already says', async () => {
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    const alpha = card(container, 'a.md');
    expect(alpha.querySelector('.type-icon')!.textContent).toBe('🚀');
    expect([...alpha.querySelectorAll('.kb-field')].map((f) => f.textContent)).toEqual(['Priority high', 'Owner Ann']);
  });

  it('the view’s visible properties choose the card’s fields', async () => {
    const { container } = render(TypeView, props({ columns: ['status', 'owner'] }));
    await screen.findByText('Alpha');
    expect([...card(container, 'a.md').querySelectorAll('.kb-field')].map((f) => f.textContent)).toEqual(['Owner Ann']);
  });

  it('clicking a card opens its note', async () => {
    const onOpenNote = vi.fn();
    const { container } = render(TypeView, props({ onOpenNote }));
    await screen.findByText('Alpha');
    await fireEvent.click(card(container, 'd.md'));
    expect(onOpenNote).toHaveBeenCalledWith('d.md');
  });

  it('groups by the picked enum property, and the picker lists only enum properties', async () => {
    const onStateChange = vi.fn();
    const { container } = render(TypeView, props({ groupBy: 'priority', onStateChange }));
    await screen.findByText('Alpha');
    expect(columns(container)).toEqual([['low', '1'], ['high', '1'], ['No value', '2']]);
    const picker = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Group by' });
    expect(picker.value).toBe('priority');
    expect([...picker.options].map((o) => o.textContent)).toEqual(['status', 'Priority']);
    await fireEvent.change(picker, { target: { value: 'status' } });
    expect(onStateChange).toHaveBeenCalledWith({ groupBy: 'status' });
  });

  it('a groupBy that is not an enum of the type falls back to the first enum', async () => {
    const { container } = render(TypeView, props({ groupBy: 'owner' }));
    await screen.findByText('Alpha');
    expect(columns(container)[0]![0]).toBe('active');
    expect((screen.getByRole<HTMLSelectElement>('combobox', { name: 'Group by' })).value).toBe('status');
  });

  it('shows no Group by picker when the type has only one enum property', async () => {
    const SINGLE = { ...PROJECT, properties: PROJECT.properties.filter((p) => p.name !== 'priority') };
    instancesMock.mockResolvedValue({ type: SINGLE, instances: FILED });
    render(TypeView, props());
    await screen.findByText('Alpha');
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

    it('a kanban spec for a type with no enum property says so rather than drawing nothing', async () => {
      instancesMock.mockResolvedValue({ type: BOOK, instances: [{ path: 'Dune.md', title: 'Dune', values: { author: 'Herbert' }, cover: null }] });
      render(TypeView, props({ typeId: 'book' }));
      expect(await screen.findByText(/no choice property to group by/i)).toBeTruthy();
    });
  });

  describe('keyboard', () => {
    it('the board is one tab stop: only the first card is tabbable to begin with', async () => {
      const { container } = render(TypeView, props());
      await screen.findByText('Alpha');
      const tabbable = [...container.querySelectorAll<HTMLElement>('[data-kanban-card]')].filter((c) => c.tabIndex === 0);
      expect(tabbable.map((c) => c.dataset['notePath'])).toEqual(['a.md']);
    });

    it('↑/↓ move within a column, ←/→ to the next column with cards, and the tab stop follows', async () => {
      const { container } = render(TypeView, props());
      await screen.findByText('Alpha');
      card(container, 'a.md').focus();

      await fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
      await vi.waitFor(() => expect(document.activeElement).toBe(card(container, 'c.md')));
      expect(card(container, 'c.md').tabIndex).toBe(0);
      expect(card(container, 'a.md').tabIndex).toBe(-1);

      // Row 2 of active → paused has one card: the nearest row, its last.
      await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
      await vi.waitFor(() => expect(document.activeElement).toBe(card(container, 'd.md')));

      await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
      await vi.waitFor(() => expect(document.activeElement).toBe(card(container, 'b.md')));

      // `abandoned` is empty and last: nowhere further right to go.
      await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(card(container, 'b.md'));

      await fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
      await vi.waitFor(() => expect(document.activeElement).toBe(card(container, 'd.md')));
      await fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
      await vi.waitFor(() => expect(document.activeElement).toBe(card(container, 'a.md')));

      await fireEvent.keyDown(document.activeElement!, { key: 'End' });
      await vi.waitFor(() => expect(document.activeElement).toBe(card(container, 'c.md')));
      await fireEvent.keyDown(document.activeElement!, { key: 'Home' });
      await vi.waitFor(() => expect(document.activeElement).toBe(card(container, 'a.md')));

      await fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
      expect(document.activeElement).toBe(card(container, 'a.md'));
    });

    it('left/right skip an empty column', async () => {
      instancesMock.mockResolvedValue({ type: PROJECT, instances: [row('a.md', 'Alpha', { status: 'active' }), row('b.md', 'Bravo', { status: 'done' })] });
      const { container } = render(TypeView, props());
      await screen.findByText('Alpha');
      card(container, 'a.md').focus();
      await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
      await vi.waitFor(() => expect(document.activeElement).toBe(card(container, 'b.md')));
    });

    it('Enter on the focused card opens it (it is a button)', async () => {
      const onOpenNote = vi.fn();
      const { container } = render(TypeView, props({ onOpenNote }));
      await screen.findByText('Alpha');
      const alpha = card(container, 'a.md');
      expect(alpha.tagName).toBe('BUTTON');
      // A button's Enter activation is a click; happy-dom doesn't synthesise it.
      await fireEvent.click(alpha);
      expect(onOpenNote).toHaveBeenCalledWith('a.md');
    });
  });

  it('renders in an embed (chromeless): the board, with no toolbar', async () => {
    const { container } = render(TypeView, props({ chromeless: true }));
    await screen.findByText('Alpha');
    expect(columns(container)).toHaveLength(4);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Group by' })).toBeNull();
  });

  it('carries the hooks card moves and column reordering attach to (#2603, #2614)', async () => {
    instancesMock.mockResolvedValue({ type: PROJECT, instances: WITH_UNFILED });
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    const cols = [...container.querySelectorAll<HTMLElement>('.kb-column')];
    expect(cols.map((c) => [c.dataset['columnValue'], c.dataset['columnKind']])).toEqual([
      ['active', 'option'], ['paused', 'option'], ['done', 'option'], ['abandoned', 'option'], ['', 'no-value'],
    ]);
    expect(cols.every((c) => c.querySelector('.kb-col-header'))).toBe(true);
    expect(cols[4]!.querySelector('[data-kanban-card]')!.getAttribute('data-note-path')).toBe('e.md');
  });
});
