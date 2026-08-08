/**
 * @vitest-environment happy-dom
 *
 * Type multi-view (#1070): the same instance set rendered as list/table/gallery,
 * sortable table columns, a cover-keyed gallery, and deep-linking a row to its
 * note. The instance set comes once from api.types.instances — switching views
 * never re-queries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { instancesMock, listMock, noteTypeMapMock } = vi.hoisted(() => ({
  instancesMock: vi.fn(),
  // The per-row type icon reads the store's note→type map (see the subclass test).
  listMock: vi.fn(), noteTypeMapMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock } },
}));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

const TYPE = {
  id: 'book',
  label: 'Book',
  classLocalName: 'Book',
  icon: '📖',
  source: 'stock' as const,
  properties: [
    { name: 'author', type: 'text' as const, label: 'Author' },
    { name: 'rating', type: 'number' as const, label: 'Rating' },
  ],
};
const INSTANCES = [
  { path: 'Dune.md', title: 'Dune', values: { author: 'Frank Herbert', rating: '5' }, cover: null },
  { path: 'Neuro.md', title: 'Neuromancer', values: { author: 'William Gibson', rating: '4' }, cover: null },
];

function props(over: Record<string, unknown> = {}) {
  return {
    typeId: 'book',
    layout: 'list' as const,
    sortColumn: null,
    sortDir: 'asc' as const,
    columns: null,
    revision: 0,
    onStateChange: vi.fn(),
    onOpenNote: vi.fn(),
    ...over,
  };
}

const NOVEL = { id: 'novel', label: 'Novel', classLocalName: 'Novel', icon: '📕', parent: 'book', source: 'user' as const, properties: [] };

/** Seed the module-singleton note→type store used for per-row icons. */
async function seedTypes(map: Record<string, string>, types: unknown[] = [TYPE, NOVEL]) {
  listMock.mockResolvedValue({ types, errors: [] });
  noteTypeMapMock.mockResolvedValue(map);
  await objectTypesStore.refresh();
}

beforeEach(async () => {
  instancesMock.mockResolvedValue({ type: TYPE, instances: INSTANCES });
  await seedTypes({});
});
afterEach(async () => { cleanup(); await seedTypes({}, []); instancesMock.mockReset(); });

describe('TypeView (#1070)', () => {
  it('renders the header (label + count) and a list of instances', async () => {
    render(TypeView, props({ layout: 'list' }));
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
    expect(screen.getByText('Neuromancer')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Book' })).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy(); // instance count
  });

  it('gives each row its OWN type icon — a subclass instance is not shown as its parent', async () => {
    // This view is subclass-aware (#1587): a Book view lists Novels too. The
    // per-row icon is what distinguishes them, so it must not just repeat the
    // header's type.
    await seedTypes({ 'Neuro.md': 'novel' });
    const { container } = render(TypeView, props({ layout: 'list' }));
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());

    const icons = [...container.querySelectorAll('.tv-list .type-icon')].map((e) => e.textContent);
    expect(icons).toEqual(['📖', '📕']);
  });

  it('falls back to the view’s type icon before the note→type map has loaded', async () => {
    await seedTypes({});
    const { container } = render(TypeView, props({ layout: 'list' }));
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());

    const icons = [...container.querySelectorAll('.tv-list .type-icon')].map((e) => e.textContent);
    expect(icons).toEqual(['📖', '📖']);
  });

  it('opens a note when an instance is clicked', async () => {
    const onOpenNote = vi.fn();
    render(TypeView, props({ layout: 'list', onOpenNote }));
    await fireEvent.click(await screen.findByText('Dune'));
    expect(onOpenNote).toHaveBeenCalledWith('Dune.md');
  });

  it('renders a column per declared property and projects the sort from props', async () => {
    // Sort is prop-driven (the tab owns it, #1072): the projection follows
    // sortColumn/sortDir, and clicking a header requests a change via onStateChange.
    const onStateChange = vi.fn();
    const { container, rerender } = render(TypeView, props({ layout: 'table', onStateChange }));
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /Author/ })).toBeTruthy());
    expect(screen.getByRole('columnheader', { name: /Rating/ })).toBeTruthy();

    // Last span in the cell is the title text — the first is the type icon.
    const titles = () => [...container.querySelectorAll('tbody .tv-cell-title-inner > span:last-child')].map((e) => e.textContent);
    expect(titles()).toEqual(['Dune', 'Neuromancer']); // intrinsic order (sortColumn null)

    // Clicking a header requests a sort — it doesn't self-sort.
    await fireEvent.click(screen.getByRole('columnheader', { name: /Rating/ }));
    expect(onStateChange).toHaveBeenCalledWith({ sortColumn: 'rating', sortDir: 'asc' });

    // Applying that sort via props reorders (Rating asc: 4 Neuromancer before 5 Dune).
    await rerender(props({ layout: 'table', sortColumn: 'rating', sortDir: 'asc' }));
    await waitFor(() => expect(titles()).toEqual(['Neuromancer', 'Dune']));
    await rerender(props({ layout: 'table', sortColumn: 'rating', sortDir: 'desc' }));
    await waitFor(() => expect(titles()).toEqual(['Dune', 'Neuromancer']));
  });

  it('hides a column when it is not in the visible set', async () => {
    render(TypeView, props({ layout: 'table', columns: ['author'] })); // rating hidden
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /Author/ })).toBeTruthy());
    expect(screen.queryByRole('columnheader', { name: /Rating/ })).toBeNull();
  });

  it('keys the gallery off the cover property, falling back to an icon card', async () => {
    instancesMock.mockResolvedValue({
      type: TYPE,
      instances: [
        { path: 'Widget.md', title: 'Widget', values: {}, cover: 'https://example.com/w.png' },
        { path: 'Gizmo.md', title: 'Gizmo', values: {}, cover: null },
      ],
    });
    const { container } = render(TypeView, props({ layout: 'gallery' }));
    await waitFor(() => expect(screen.getByText('Widget')).toBeTruthy());
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.com/w.png');
    expect(container.querySelectorAll('img')).toHaveLength(1); // Gizmo falls back to an icon, no img
  });

  it('switches views without re-querying the instance set', async () => {
    const onStateChange = vi.fn();
    render(TypeView, props({ layout: 'list', onStateChange }));
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(onStateChange).toHaveBeenCalledWith({ layout: 'table' });
    expect(instancesMock).toHaveBeenCalledTimes(1); // one load, not one per view
  });
});
