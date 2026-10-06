/**
 * @vitest-environment happy-dom
 *
 * Objects-by-type sidebar (#1068): lists registry types with live instance
 * counts (zero-instance types visible), expands to instances via a graph
 * projection, and opens a note on click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { typesMock, queryMock, noteTypeMapMock } = vi.hoisted(() => ({
  typesMock: vi.fn(), queryMock: vi.fn(),
  // Instance rows carry a per-row type icon read from the store's map.
  noteTypeMapMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { list: typesMock, noteTypeMap: noteTypeMapMock }, graph: { query: queryMock } },
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
  // happy-dom's localStorage isn't wired for a functional getItem here (same
  // gap CollectionsTree.test.ts works around); the "hide empty" preference
  // (#2664) is read/written through it. In-memory stand-in.
  const ls: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls[k] ?? null,
    setItem: (k: string, v: string) => { ls[k] = v; },
    removeItem: (k: string) => { delete ls[k]; },
    clear: () => { for (const k of Object.keys(ls)) delete ls[k]; },
  });
  typesMock.mockResolvedValue({ types: [BOOK, MEETING], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  queryMock.mockImplementation((sparql: string) => {
    if (sparql.includes('thought:Excerpt')) return Promise.resolve({ ok: true, results: [{ n: '7' }], columns: [] }); // excerpt count
    if (sparql.includes('COUNT')) return Promise.resolve({ ok: true, results: [{ id: 'book', n: '2' }], columns: [] });
    if (sparql.includes('types:Book')) {
      return Promise.resolve({ ok: true, results: [{ path: 'Dune.md', title: 'Dune' }, { path: 'Neuro.md', title: 'Neuromancer' }], columns: [] });
    }
    return Promise.resolve({ ok: true, results: [], columns: [] });
  });
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await seedTypes({}, []); // the store is a module singleton — don't leak a map
  typesMock.mockReset(); queryMock.mockReset(); noteTypeMapMock.mockReset();
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

describe('ObjectsPanel: hide empty object types (#2664)', () => {
  /** Route the count queries; anything else answers empty. */
  function answerCounts(counts: Array<{ id: string; n: string }>, excerpts: string): void {
    queryMock.mockImplementation((sparql: string) => {
      if (sparql.includes('thought:Excerpt')) return Promise.resolve({ ok: true, results: [{ n: excerpts }], columns: [] });
      if (sparql.includes('COUNT')) return Promise.resolve({ ok: true, results: counts, columns: [] });
      return Promise.resolve({ ok: true, results: [], columns: [] });
    });
  }
  const toggle = () => screen.getByRole('checkbox', { name: /hide empty/i });

  it('is off by default: zero-count rows stay visible', async () => {
    answerCounts([{ id: 'book', n: '2' }], '0');
    render(ObjectsPanel, { onFileSelect: vi.fn() });
    await screen.findByText('Book');
    expect((toggle() as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('Meeting')).toBeTruthy();
    expect(screen.getByText('Excerpts')).toBeTruthy();
  });

  it('toggled on, hides zero-count type rows and an empty Excerpts row', async () => {
    answerCounts([{ id: 'book', n: '2' }], '0');
    render(ObjectsPanel, { onFileSelect: vi.fn() });
    await screen.findByText('Meeting');
    await fireEvent.click(toggle());
    await waitFor(() => expect(screen.queryByText('Meeting')).toBeNull());
    expect(screen.getByText('Book')).toBeTruthy();
    expect(screen.queryByText('Excerpts')).toBeNull();
  });

  it('keeps the Excerpts row while there are excerpts', async () => {
    answerCounts([], '3');
    render(ObjectsPanel, { onFileSelect: vi.fn() });
    await screen.findByText('Excerpts');
    await fireEvent.click(toggle());
    await waitFor(() => expect(screen.queryByText('Book')).toBeNull());
    expect(screen.getByText('Excerpts')).toBeTruthy();
  });

  it('keeps a parent whose only instances are through a subtype', async () => {
    // Book has no direct instances, but a Novel counts toward it (#1587): the
    // subclass-aware count query reports book=1, and that is what the row shows.
    typesMock.mockResolvedValue({ types: [BOOK, MEETING, NOVEL], errors: [] });
    answerCounts([{ id: 'book', n: '1' }, { id: 'novel', n: '1' }], '0');
    render(ObjectsPanel, { onFileSelect: vi.fn() });
    await screen.findByText('Meeting');
    await fireEvent.click(toggle());
    await waitFor(() => expect(screen.queryByText('Meeting')).toBeNull());
    expect(screen.getByText('Book')).toBeTruthy();
    expect(screen.getByText('Novel')).toBeTruthy();
  });

  it('says so when everything is hidden, and "Show all" turns the filter off', async () => {
    answerCounts([], '0');
    render(ObjectsPanel, { onFileSelect: vi.fn() });
    await screen.findByText('Book');
    await fireEvent.click(toggle());
    await screen.findByText(/no object types in use/i);
    expect(screen.queryByText('Book')).toBeNull();
    expect(screen.queryByText(/no types or excerpts/i)).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    await screen.findByText('Book');
    expect((toggle() as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(/no object types in use/i)).toBeNull();
  });

  it('keeps the no-types empty state for a catalog with nothing in it', async () => {
    typesMock.mockResolvedValue({ types: [], errors: [] });
    answerCounts([], '0');
    localStorage.setItem('minerva.objectsPanel.hideEmpty', 'true');
    render(ObjectsPanel, { onFileSelect: vi.fn() });
    await screen.findByText(/no types or excerpts in this project yet/i);
    expect(screen.queryByText(/no object types in use/i)).toBeNull();
  });

  it('remembers the preference across a remount', async () => {
    answerCounts([{ id: 'book', n: '2' }], '0');
    const first = render(ObjectsPanel, { onFileSelect: vi.fn() });
    await screen.findByText('Meeting');
    await fireEvent.click(toggle());
    await waitFor(() => expect(screen.queryByText('Meeting')).toBeNull());
    first.unmount();

    render(ObjectsPanel, { onFileSelect: vi.fn() });
    await screen.findByText('Book');
    expect((toggle() as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText('Meeting')).toBeNull();
  });

  it('falls back to off when localStorage throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    answerCounts([{ id: 'book', n: '2' }], '0');
    render(ObjectsPanel, { onFileSelect: vi.fn() });
    await screen.findByText('Meeting');
    await fireEvent.click(toggle()); // still toggles for the session
    await waitFor(() => expect(screen.queryByText('Meeting')).toBeNull());
  });

  it('updates live: a type that gains an instance reappears on refresh()', async () => {
    answerCounts([{ id: 'book', n: '2' }], '0');
    const { component } = render(ObjectsPanel, { onFileSelect: vi.fn() });
    await screen.findByText('Meeting');
    await fireEvent.click(toggle());
    await waitFor(() => expect(screen.queryByText('Meeting')).toBeNull());

    answerCounts([{ id: 'book', n: '2' }, { id: 'meeting', n: '1' }], '0');
    await component.refresh();
    await screen.findByText('Meeting');

    answerCounts([{ id: 'meeting', n: '1' }], '0');
    await component.refresh();
    await waitFor(() => expect(screen.queryByText('Book')).toBeNull());
  });

  it('offers the same toggle from the panel context menu', async () => {
    answerCounts([{ id: 'book', n: '2' }], '0');
    const { container } = render(ObjectsPanel, { onFileSelect: vi.fn() });
    await screen.findByText('Meeting');
    await fireEvent.contextMenu(container.querySelector('.objects-panel')!);
    const item = await screen.findByRole('menuitemcheckbox', { name: /hide empty object types/i });
    expect(item.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(item);
    await waitFor(() => expect(screen.queryByText('Meeting')).toBeNull());
    expect((toggle() as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
  });
});
