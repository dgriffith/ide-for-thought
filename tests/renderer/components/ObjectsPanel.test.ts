/**
 * @vitest-environment happy-dom
 *
 * Objects-by-type sidebar (#1068): lists registry types with live instance
 * counts (zero-instance types visible), expands to instances via a graph
 * projection, and opens a note on click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { typesMock, queryMock, viewsListMock, noteTypeMapMock } = vi.hoisted(() => ({
  typesMock: vi.fn(), queryMock: vi.fn(), viewsListMock: vi.fn(),
  // Instance rows carry a per-row type icon read from the store's map.
  noteTypeMapMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { list: typesMock, noteTypeMap: noteTypeMapMock }, graph: { query: queryMock }, views: { list: viewsListMock } },
}));

import ObjectsPanel from '../../../src/renderer/lib/components/ObjectsPanel.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

const BOOK = { id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock', icon: '📖', properties: [] };
const MEETING = { id: 'meeting', label: 'Meeting', classLocalName: 'Meeting', source: 'stock', icon: '🗓️', properties: [] };
const NOVEL = { id: 'novel', label: 'Novel', classLocalName: 'Novel', parent: 'book', source: 'user', icon: '📕', properties: [] };

/** Seed the module-singleton note→type store used for the per-row icons. */
async function seedTypes(map: Record<string, string>, types: unknown[] = [BOOK, MEETING, NOVEL]) {
  typesMock.mockResolvedValue({ types, errors: [] });
  noteTypeMapMock.mockResolvedValue(map);
  await objectTypesStore.refresh();
}

beforeEach(async () => {
  typesMock.mockResolvedValue({ types: [BOOK, MEETING], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  viewsListMock.mockResolvedValue([]); // saved-views store refresh (#1072)
  queryMock.mockImplementation((sparql: string) => {
    if (sparql.includes('thought:Excerpt')) return Promise.resolve({ results: [{ n: '7' }], columns: [] }); // excerpt count
    if (sparql.includes('COUNT')) return Promise.resolve({ results: [{ id: 'book', n: '2' }], columns: [] });
    if (sparql.includes('types:Book')) {
      return Promise.resolve({ results: [{ path: 'Dune.md', title: 'Dune' }, { path: 'Neuro.md', title: 'Neuromancer' }], columns: [] });
    }
    return Promise.resolve({ results: [], columns: [] });
  });
});
afterEach(async () => {
  cleanup();
  await seedTypes({}, []); // the store is a module singleton — don't leak a map
  typesMock.mockReset(); queryMock.mockReset(); viewsListMock.mockReset(); noteTypeMapMock.mockReset();
});

describe('ObjectsPanel (#1068)', () => {
  it('lists types with instance counts, including a zero-instance type', async () => {
    render(ObjectsPanel, { onFileSelect: vi.fn() });
    await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
    expect(screen.getByText('Meeting')).toBeTruthy(); // zero-instance, still shown
    expect(screen.getByText('2')).toBeTruthy(); // Book count
    expect(screen.getByText('0')).toBeTruthy(); // Meeting count
    expect(screen.getByText('Excerpts')).toBeTruthy(); // built-in Excerpts type (#1069)
    expect(screen.getByText('7')).toBeTruthy(); // excerpt count
  });

  it('expands a type to its instances and opens a note on click', async () => {
    const onFileSelect = vi.fn();
    render(ObjectsPanel, { onFileSelect });
    const bookRow = await screen.findByText('Book');
    await fireEvent.click(bookRow);
    const dune = await screen.findByText('Dune');
    expect(screen.getByText('Neuromancer')).toBeTruthy();
    await fireEvent.click(dune);
    expect(onFileSelect).toHaveBeenCalledWith('Dune.md');
  });

  it('gives each instance row its OWN type icon, not the group’s', async () => {
    // The group query is subclass-aware (#1587), so a Book group lists Novels.
    // The per-row icon is what tells them apart.
    await seedTypes({ 'Dune.md': 'book', 'Neuro.md': 'novel' });
    const { container } = render(ObjectsPanel, { onFileSelect: vi.fn() });
    await fireEvent.click(await screen.findByText('Book'));
    await screen.findByText('Dune');

    const icons = [...container.querySelectorAll('.instance-row .type-icon')].map((e) => e.textContent);
    expect(icons).toEqual(['📖', '📕']);
  });

  it('falls back to the group’s type icon for a row missing from the note→type map', async () => {
    await seedTypes({});
    const { container } = render(ObjectsPanel, { onFileSelect: vi.fn() });
    await fireEvent.click(await screen.findByText('Book'));
    await screen.findByText('Dune');

    const icons = [...container.querySelectorAll('.instance-row .type-icon')].map((e) => e.textContent);
    expect(icons).toEqual(['📖', '📖']);
  });

  it('shows an empty state for an expanded type with no instances', async () => {
    render(ObjectsPanel, { onFileSelect: vi.fn() });
    const meetingRow = await screen.findByText('Meeting');
    await fireEvent.click(meetingRow);
    await waitFor(() => expect(screen.getByText(/no meeting yet/i)).toBeTruthy());
  });
});
