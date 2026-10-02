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
// #2066: TypeViewMap's own mount logic is covered by TypeViewMap.test.ts —
// here it's a stub, so switching into the "Map" layout in these tests never
// touches real MapLibre GL / network.
vi.mock('../../../src/renderer/lib/map/load-maplibre', () => ({
  loadMapLibre: vi.fn(() => new Promise(() => {})), // never resolves — component stays in its pre-mount state
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

  describe('Map layout (#2066)', () => {
    const PLACE = {
      id: 'place', label: 'Place', classLocalName: 'Place', icon: '📍', source: 'stock' as const,
      properties: [{ name: 'location', type: 'geo' as const, label: 'Location' }],
    };
    const PLACE_INSTANCES = [
      { path: 'SF.md', title: 'San Francisco', values: { location: '37.7749,-122.4194' }, cover: null },
    ];

    it('shows the Map tab only for a type with a geo property', async () => {
      render(TypeView, props({ layout: 'list' }));
      await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
      expect(screen.queryByRole('tab', { name: 'Map' })).toBeNull(); // Book has no geo property

      instancesMock.mockResolvedValue({ type: PLACE, instances: PLACE_INSTANCES });
      render(TypeView, props({ typeId: 'place', layout: 'list' }));
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Map' })).toBeTruthy());
    });

    it('renders the map when the layout is map and the type has a geo property', async () => {
      instancesMock.mockResolvedValue({ type: PLACE, instances: PLACE_INSTANCES });
      const { container } = render(TypeView, props({ typeId: 'place', layout: 'map' }));
      await waitFor(() => expect(container.querySelector('[aria-label="Map"]')).toBeTruthy());
    });

    it('falls back to a message instead of mounting the map when the type has no geo property', async () => {
      // A stale saved-view/tab-state claims layout: 'map' for a type that no
      // longer has (or never had) a geo property.
      render(TypeView, props({ layout: 'map' })); // Book
      await waitFor(() => expect(screen.getByText(/no location property/i)).toBeTruthy());
    });

    it('shows the Map tab for a subclass of Place that declares no geo property of its own', async () => {
      // The subclass inherits `location` from Place rather than redeclaring
      // it — allColumns must resolve effective (inherited) properties, not
      // just the type's own, or the Map option silently disappears.
      const LANDMARK = {
        id: 'landmark', label: 'Landmark', classLocalName: 'Landmark', icon: '🗽',
        parent: 'place', source: 'user' as const, properties: [],
      };
      await seedTypes({}, [TYPE, PLACE, LANDMARK]);
      instancesMock.mockResolvedValue({ type: LANDMARK, instances: PLACE_INSTANCES });
      render(TypeView, props({ typeId: 'landmark', layout: 'list' }));
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Map' })).toBeTruthy());
    });
  });

  describe('Copy as markdown (#2068)', () => {
    let writeText: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      writeText = vi.fn();
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });

    it('copies a table layout as a markdown table matching the compute-cell format, respecting sort/columns', async () => {
      render(TypeView, props({ layout: 'table', sortColumn: 'rating', sortDir: 'asc', columns: ['author'] }));
      await waitFor(() => expect(screen.getByRole('columnheader', { name: /Author/ })).toBeTruthy());
      await fireEvent.click(screen.getByText('Copy as markdown'));

      expect(writeText).toHaveBeenCalledWith(
        '| Title | Author |\n| --- | --- |\n| Neuromancer | William Gibson |\n| Dune | Frank Herbert |',
      );
    });

    it('copies a list layout as a wiki-linked bullet list with the on-screen summary', async () => {
      render(TypeView, props({ layout: 'list' }));
      await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
      await fireEvent.click(screen.getByText('Copy as markdown'));

      expect(writeText).toHaveBeenCalledWith(
        '- [[Dune]] — Author: Frank Herbert\n- [[Neuro]] — Author: William Gibson',
      );
    });

    it('falls back to the same bullet-list format for gallery (no literal grid markdown)', async () => {
      render(TypeView, props({ layout: 'gallery' }));
      await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
      await fireEvent.click(screen.getByText('Copy as markdown'));

      expect(writeText).toHaveBeenCalledWith(
        '- [[Dune]] — Author: Frank Herbert\n- [[Neuro]] — Author: William Gibson',
      );
    });

    it('is not offered in chromeless (inline-embed) mode', async () => {
      render(TypeView, props({ layout: 'list', chromeless: true }));
      await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
      expect(screen.queryByText('Copy as markdown')).toBeNull();
    });

    it('flashes "Copied" after a successful copy — the only visible sign the button did anything', async () => {
      // Report: "doesn't appear to do anything" — a clipboard write has no
      // other observable effect, so with zero feedback a real success reads
      // identically to a silent failure.
      render(TypeView, props({ layout: 'list' }));
      await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
      await fireEvent.click(screen.getByText('Copy as markdown'));
      await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    });
  });

  describe('Save as note (#2507)', () => {
    it('is not offered when onSaveView is omitted', async () => {
      render(TypeView, props({ layout: 'list' }));
      await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
      expect(screen.queryByText('Save as note')).toBeNull();
    });

    it('flashes "Saved" after onSaveView resolves true', async () => {
      // Report: "pops up a note name box, which then does nothing" — the
      // save itself was working; a cancelled prompt and a real save both
      // gave zero feedback, so they looked identical.
      const onSaveView = vi.fn().mockResolvedValue(true);
      render(TypeView, props({ layout: 'list', onSaveView }));
      await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
      await fireEvent.click(screen.getByText('Save as note'));
      expect(onSaveView).toHaveBeenCalled();
      await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    });

    it('does not flash "Saved" when onSaveView resolves false (the name prompt was cancelled)', async () => {
      const onSaveView = vi.fn().mockResolvedValue(false);
      render(TypeView, props({ layout: 'list', onSaveView }));
      await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
      await fireEvent.click(screen.getByText('Save as note'));
      // Await the exact promise the click handler is also awaiting: since its
      // `.then` was attached first (at click time), this guarantees the
      // handler's post-await `if (saved)` branch has already run by the time
      // we assert, without an arbitrary tick/timeout.
      await onSaveView.mock.results[0]?.value;
      expect(onSaveView).toHaveBeenCalled();
      expect(screen.queryByText('Saved')).toBeNull();
      expect(screen.getByText('Save as note')).toBeTruthy();
    });
  });

  describe('chromeless (#2067)', () => {
    it('suppresses the header/toolbar but renders the body identically', async () => {
      const { container } = render(TypeView, props({ layout: 'list', chromeless: true }));
      await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
      expect(container.querySelector('.tv-header')).toBeNull();
      expect(screen.getByText('Neuromancer')).toBeTruthy();
    });

    it('shows the header/toolbar by default', async () => {
      const { container } = render(TypeView, props({ layout: 'list' }));
      await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
      expect(container.querySelector('.tv-header')).not.toBeNull();
    });
  });
});

describe('folder scope and filters (#2531)', () => {
  const SCOPED = [
    { path: 'shelf/a/Dune.md', title: 'Dune', values: { author: 'Frank Herbert', rating: '5' }, cover: null },
    { path: 'shelf/a/Neuro.md', title: 'Neuromancer', values: { author: 'William Gibson', rating: '4' }, cover: null },
    { path: 'shelf/b/Foundation.md', title: 'Foundation', values: { author: 'Isaac Asimov', rating: '5' }, cover: null },
  ];
  beforeEach(() => { instancesMock.mockResolvedValue({ type: TYPE, instances: SCOPED }); });

  it('shows only the folder\'s instances, through the filters, with an n-of-m count', async () => {
    const { container } = render(TypeView, props({ folder: 'shelf/a', filters: [{ property: 'rating', min: '5' }] }));
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
    expect(screen.queryByText('Neuromancer')).toBeNull(); // in the folder, filtered out
    expect(screen.queryByText('Foundation')).toBeNull(); // passes the filter, outside the folder
    expect(container.querySelector('.tv-count')!.textContent).toBe('1 of 3');
  });

  it('says so when nothing in scope matches', async () => {
    render(TypeView, props({ folder: 'shelf/b', filters: [{ property: 'author', values: ['Nobody'] }] }));
    await waitFor(() => expect(screen.getByText('No book in shelf/b match these filters.')).toBeTruthy());
  });

  it('applies the same scope chromeless — what an embed or export shows', async () => {
    render(TypeView, props({ chromeless: true, folder: 'shelf/b' }));
    await waitFor(() => expect(screen.getByText('Foundation')).toBeTruthy());
    expect(screen.queryByText('Dune')).toBeNull();
  });

  it('chromeless with folder + filters: the filtered set, and no controls at all (#2534)', async () => {
    const { container } = render(TypeView, props({
      chromeless: true, folder: 'shelf/a', filters: [{ property: 'rating', min: '5' }], onClearFolder: vi.fn(),
    }));
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
    expect(screen.queryByText('Neuromancer')).toBeNull();
    expect(screen.queryByText('Foundation')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Filter ▾' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove filter/ })).toBeNull();
    expect(screen.queryByText('in shelf/a')).toBeNull();
    expect(container.querySelector('.tv-filters, .tv-chip, .tv-count')).toBeNull();
  });

  it('the panel (not chromeless) does show them for the same spec', async () => {
    render(TypeView, props({ folder: 'shelf/a', filters: [{ property: 'rating', min: '5' }], onClearFolder: vi.fn() }));
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Filter ▾' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rating: ≥ 5' })).toBeTruthy();
    expect(screen.getByText('in shelf/a')).toBeTruthy();
  });
});

describe('the folder chip (#2532)', () => {
  beforeEach(() => {
    instancesMock.mockResolvedValue({ type: TYPE, instances: [{ path: 'shelf/a/Dune.md', title: 'Dune', values: { author: 'Frank Herbert', rating: '5' }, cover: null }] });
  });

  it('shows the scope in the panel and widens it on ✕', async () => {
    const onClearFolder = vi.fn();
    render(TypeView, props({ folder: 'shelf/a', onClearFolder }));
    await waitFor(() => expect(screen.getByText('in shelf/a')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Show Book from the whole thoughtbase' }));
    expect(onClearFolder).toHaveBeenCalled();
  });

  it('isn\'t shown unscoped, or chromeless (an embed or export)', async () => {
    const { unmount } = render(TypeView, props({ onClearFolder: vi.fn() }));
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
    expect(screen.queryByText(/^in /)).toBeNull();
    unmount();
    render(TypeView, props({ folder: 'shelf/a', chromeless: true, onClearFolder: vi.fn() }));
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
    expect(screen.queryByText('in shelf/a')).toBeNull();
  });
});
