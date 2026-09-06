/**
 * @vitest-environment happy-dom
 *
 * CollectionsTree render test (#2057). Extracted out of SourcesPanel.svelte
 * in #2048 with no test of its own — `SourcesPanel.test.ts`'s black-box
 * render exercises the read path (rendering the tree, selecting a row) but
 * none of the write paths this file owns: creating/renaming/deleting a
 * manual collection, creating/editing/deleting a smart collection, and
 * expand/collapse of nested collections. Measured before this file existed:
 * 27.19% statements / 13.46% branches — the exact "large component hiding
 * inside the aggregate" shape #2057 is about.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';
import type { Collection, SmartCollection } from '../../../src/shared/types';

const h = vi.hoisted(() => ({
  sourceData: {
    createCollection: vi.fn(),
    renameCollection: vi.fn(),
    removeCollection: vi.fn(),
    createSmartCollection: vi.fn(),
    renameSmartCollection: vi.fn(),
    removeSmartCollection: vi.fn(),
    updateSmartPredicate: vi.fn(),
  },
  api: {
    tags: { list: vi.fn() },
  },
}));

vi.mock('../../../src/renderer/lib/stores/source-data.svelte', () => ({ getSourceDataStore: () => h.sourceData }));
// SmartCollectionEditorDialog (mounted for real, not mocked out) reads the
// project's tag vocabulary via api.tags.list() on mount.
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import CollectionsTree from '../../../src/renderer/lib/components/CollectionsTree.svelte';

const parent: Collection = { id: 'c-parent', name: 'Parent', parent: null, members: ['s1'] };
const child: Collection = { id: 'c-child', name: 'Child', parent: 'c-parent', members: ['s2'] };
const smart: SmartCollection = { id: 'sm-1', name: 'Unread Papers', predicate: { kind: 'tags', allOf: ['paper'] } };

function props(over: Record<string, unknown> = {}) {
  return {
    collections: [parent, child],
    smartCollections: [smart],
    activeCollectionId: null,
    allSourcesActive: true,
    allSourcesCount: 2,
    onSelect: vi.fn(),
    onShowPrompt: vi.fn().mockResolvedValue(null),
    onShowConfirm: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

beforeEach(() => {
  // happy-dom's localStorage isn't wired for a functional getItem here (same
  // gap Editor.test.ts works around); the component reads/writes expand
  // state and the "queue expanded" preference through it. In-memory stand-in.
  const ls: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls[k] ?? null,
    setItem: (k: string, v: string) => { ls[k] = v; },
    removeItem: (k: string) => { delete ls[k]; },
    clear: () => { for (const k of Object.keys(ls)) delete ls[k]; },
  });
  h.api.tags.list.mockResolvedValue([{ tag: 'paper', sourceCount: 3, noteCount: 0 }]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('CollectionsTree (#2057)', () => {
  it('renders All sources, top-level collections, and smart collections', async () => {
    render(CollectionsTree, props());
    await waitFor(() => expect(screen.getByText('All sources')).toBeTruthy());
    expect(screen.getByText('Parent')).toBeTruthy();
    expect(screen.getByText('Unread Papers')).toBeTruthy();
    // A nested child starts collapsed by default (no prior localStorage state).
    expect(screen.queryByText('Child')).toBeNull();
  });

  it('clicking "All sources" selects null', async () => {
    const p = props();
    render(CollectionsTree, p);
    await fireEvent.click(screen.getByText('All sources'));
    expect(p.onSelect).toHaveBeenCalledWith(null);
  });

  it('clicking a collection row selects its id', async () => {
    const p = props();
    render(CollectionsTree, p);
    await fireEvent.click(screen.getByText('Parent'));
    expect(p.onSelect).toHaveBeenCalledWith('c-parent');
  });

  it('expands a collection with children on chevron click', async () => {
    render(CollectionsTree, props());
    await waitFor(() => expect(screen.getByText('Parent')).toBeTruthy());
    const row = screen.getByText('Parent').closest('button')!;
    const chevron = row.querySelector('.chevron')!;
    await fireEvent.click(chevron);
    await waitFor(() => expect(screen.getByText('Child')).toBeTruthy());
  });

  it('expands a collection with children on chevron Enter/Space (keyboard access)', async () => {
    render(CollectionsTree, props());
    await waitFor(() => expect(screen.getByText('Parent')).toBeTruthy());
    const row = screen.getByText('Parent').closest('button')!;
    const chevron = row.querySelector('.chevron')!;
    await fireEvent.keyDown(chevron, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Child')).toBeTruthy());
  });

  it('clicking a smart-collection row selects its id', async () => {
    const p = props();
    render(CollectionsTree, p);
    await fireEvent.click(screen.getByText('Unread Papers'));
    expect(p.onSelect).toHaveBeenCalledWith('sm-1');
  });

  it('creates a new top-level collection via the + menu and prompt', async () => {
    const p = props({ onShowPrompt: vi.fn().mockResolvedValue('New Collection') });
    render(CollectionsTree, p);
    await fireEvent.click(screen.getByTitle('New collection…'));
    await fireEvent.click(await screen.findByText('New collection…', { selector: 'button' }));
    await waitFor(() => expect(h.sourceData.createCollection).toHaveBeenCalledWith({ name: 'New Collection', parent: null }));
  });

  it('does not create a collection when the prompt is cancelled', async () => {
    const p = props({ onShowPrompt: vi.fn().mockResolvedValue(null) });
    render(CollectionsTree, p);
    await fireEvent.click(screen.getByTitle('New collection…'));
    await fireEvent.click(await screen.findByText('New collection…', { selector: 'button' }));
    await waitFor(() => expect(p.onShowPrompt).toHaveBeenCalled());
    expect(h.sourceData.createCollection).not.toHaveBeenCalled();
  });

  it('renames a collection via the context menu', async () => {
    const p = props({ onShowPrompt: vi.fn().mockResolvedValue('Renamed') });
    render(CollectionsTree, p);
    await waitFor(() => expect(screen.getByText('Parent')).toBeTruthy());
    await fireEvent.contextMenu(screen.getByText('Parent'));
    await fireEvent.click(await screen.findByText('Rename…'));
    await waitFor(() => expect(h.sourceData.renameCollection).toHaveBeenCalledWith('c-parent', 'Renamed'));
  });

  it('deletes a collection via the context menu, confirmed', async () => {
    const p = props({ activeCollectionId: 'c-parent' });
    render(CollectionsTree, p);
    await waitFor(() => expect(screen.getByText('Parent')).toBeTruthy());
    await fireEvent.contextMenu(screen.getByText('Parent'));
    await fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() => expect(h.sourceData.removeCollection).toHaveBeenCalledWith('c-parent'));
    // The deleted collection was active — selection clears to "All sources".
    expect(p.onSelect).toHaveBeenCalledWith(null);
  });

  it('does not delete a collection when the confirm is declined', async () => {
    const p = props({ onShowConfirm: vi.fn().mockResolvedValue(false) });
    render(CollectionsTree, p);
    await waitFor(() => expect(screen.getByText('Parent')).toBeTruthy());
    await fireEvent.contextMenu(screen.getByText('Parent'));
    await fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() => expect(p.onShowConfirm).toHaveBeenCalled());
    expect(h.sourceData.removeCollection).not.toHaveBeenCalled();
  });

  it('renames a smart collection via its context menu', async () => {
    const p = props({ onShowPrompt: vi.fn().mockResolvedValue('New Name') });
    render(CollectionsTree, p);
    await waitFor(() => expect(screen.getByText('Unread Papers')).toBeTruthy());
    await fireEvent.contextMenu(screen.getByText('Unread Papers'));
    await fireEvent.click(await screen.findByText('Rename…'));
    await waitFor(() => expect(h.sourceData.renameSmartCollection).toHaveBeenCalledWith('sm-1', 'New Name'));
  });

  it('deletes a smart collection via its context menu, confirmed', async () => {
    render(CollectionsTree, props());
    await waitFor(() => expect(screen.getByText('Unread Papers')).toBeTruthy());
    await fireEvent.contextMenu(screen.getByText('Unread Papers'));
    await fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() => expect(h.sourceData.removeSmartCollection).toHaveBeenCalledWith('sm-1'));
  });

  it('opens the smart-collection editor from the + menu and creates on save', async () => {
    h.sourceData.createSmartCollection.mockResolvedValue({ id: 'sm-new', name: 'New Smart', predicate: { kind: 'tags', allOf: ['paper'] } });
    const p = props();
    render(CollectionsTree, p);
    await fireEvent.click(screen.getByTitle('New collection…'));
    await fireEvent.click(await screen.findByText('New smart collection…'));

    // Real SmartCollectionEditorDialog: name it, pick a tag, save.
    const nameInput = await screen.findByPlaceholderText('Collection name');
    await fireEvent.input(nameInput, { target: { value: 'New Smart' } });
    const tagCheckbox = await screen.findByRole('checkbox');
    await fireEvent.click(tagCheckbox);
    await fireEvent.click(screen.getByText('Create'));

    await waitFor(() => expect(h.sourceData.createSmartCollection).toHaveBeenCalledWith({
      name: 'New Smart', predicate: { kind: 'tags', allOf: ['paper'] },
    }));
    // Auto-focuses the newly created smart collection.
    expect(p.onSelect).toHaveBeenCalledWith('sm-new');
    // The dialog closes after a successful save.
    await waitFor(() => expect(screen.queryByPlaceholderText('Collection name')).toBeNull());
  });

  it('opens the smart-collection editor from the context menu for editing, pre-filled', async () => {
    render(CollectionsTree, props());
    await waitFor(() => expect(screen.getByText('Unread Papers')).toBeTruthy());
    await fireEvent.contextMenu(screen.getByText('Unread Papers'));
    await fireEvent.click(await screen.findByText('Edit query…'));

    const nameInput = await screen.findByPlaceholderText('Collection name');
    expect((nameInput as HTMLInputElement).value).toBe('Unread Papers');
    await fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByPlaceholderText('Collection name')).toBeNull());
    // Cancelling doesn't touch the store.
    expect(h.sourceData.updateSmartPredicate).not.toHaveBeenCalled();
  });

  it('saves an edited smart collection: renames + updates the predicate, re-selects if active', async () => {
    const p = props({ activeCollectionId: 'sm-1' });
    render(CollectionsTree, p);
    await waitFor(() => expect(screen.getByText('Unread Papers')).toBeTruthy());
    await fireEvent.contextMenu(screen.getByText('Unread Papers'));
    await fireEvent.click(await screen.findByText('Edit query…'));

    const nameInput = await screen.findByPlaceholderText('Collection name');
    await fireEvent.input(nameInput, { target: { value: 'Renamed Smart' } });
    await fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(h.sourceData.renameSmartCollection).toHaveBeenCalledWith('sm-1', 'Renamed Smart'));
    expect(h.sourceData.updateSmartPredicate).toHaveBeenCalledWith('sm-1', { kind: 'tags', allOf: ['paper'] });
    // It was the active collection, so saving re-selects it (forces a re-fetch).
    expect(p.onSelect).toHaveBeenCalledWith('sm-1');
  });
});
