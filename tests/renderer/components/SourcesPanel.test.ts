/**
 * @vitest-environment happy-dom
 *
 * SourcesPanel render/smoke test (baseline coverage). SourcesPanel is the
 * left-sidebar Sources view: it owns the collection tree, the reading-queue
 * rows, the free-text filter, the flat source list, and every source /
 * collection context menu. It had 0% coverage of its own file. This mounts the
 * real component against mocked IPC + the source-data store and asserts the
 * user-visible wiring: the source list renders from `api.sources.listAll`,
 * the filter narrows it, selecting a collection scopes it to that collection's
 * members, selecting a queue view re-queries members, row clicks route to
 * `onSourceSelect`, and the right-click menu routes rename / delete through the
 * `source-actions` helpers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';
import type { SourceMetadata, Collection, CollectionsFile } from '../../../src/shared/types';

function source(over: Partial<SourceMetadata> = {}): SourceMetadata {
  return {
    sourceId: 'paxos', subtype: 'article', title: 'The Part-Time Parliament',
    creators: ['Lamport, Leslie'], year: '1998', publisher: null, doi: null, uri: null,
    abstract: null, readStatus: null, readDueBy: null, stubStatus: null, tags: [],
    ...over,
  };
}

const paxos = source();
const raft = source({
  sourceId: 'raft', title: 'In Search of an Understandable Consensus Algorithm',
  creators: ['Ongaro, Diego'], year: '2014',
});
const consensus: Collection = { id: 'c1', name: 'Consensus', parent: null, members: ['paxos'] };

const h = vi.hoisted(() => ({
  api: {
    sources: {
      listAll: vi.fn(),
      queueMembers: vi.fn(),
    },
    collections: {
      list: vi.fn(),
      smartMembers: vi.fn(),
    },
  },
  sourceData: {
    onCollectionsChanged: vi.fn(() => () => {}),
    setReadStatus: vi.fn(),
    setReadDueBy: vi.fn(),
    merge: vi.fn(),
    ingestSmart: vi.fn(),
    stripUpstreamTags: vi.fn(),
    createCollection: vi.fn(),
    renameCollection: vi.fn(),
    removeCollection: vi.fn(),
    addSourceToCollection: vi.fn(),
    removeSourceFromCollection: vi.fn(),
    createSmartCollection: vi.fn(),
    renameSmartCollection: vi.fn(),
    removeSmartCollection: vi.fn(),
    updateSmartPredicate: vi.fn(),
  },
  linkDrag: { start: vi.fn() },
  renameSource: vi.fn(),
  deleteSource: vi.fn(),
  addSourceTag: vi.fn(),
  sourceTagSuggestions: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/source-data.svelte', () => ({ getSourceDataStore: () => h.sourceData }));
vi.mock('../../../src/renderer/lib/stores/link-drag.svelte', () => ({ getLinkDrag: () => h.linkDrag }));
vi.mock('../../../src/renderer/lib/sources/source-actions', () => ({
  renameSource: h.renameSource,
  deleteSource: h.deleteSource,
  addSourceTag: h.addSourceTag,
  sourceTagSuggestions: h.sourceTagSuggestions,
}));

import SourcesPanel from '../../../src/renderer/lib/components/SourcesPanel.svelte';

function props(over: Record<string, unknown> = {}) {
  return {
    onSourceSelect: vi.fn(),
    onSourceDeleted: vi.fn(),
    onShowConfirm: vi.fn().mockResolvedValue(true),
    onShowPrompt: vi.fn().mockResolvedValue(null),
    onSourceOpened: vi.fn(),
    ...over,
  };
}

const collectionsFile: CollectionsFile = { collections: [consensus], smartCollections: [] };

beforeEach(() => {
  h.api.sources.listAll.mockResolvedValue([paxos, raft]);
  h.api.sources.queueMembers.mockResolvedValue([]);
  h.api.collections.list.mockResolvedValue(collectionsFile);
  h.api.collections.smartMembers.mockResolvedValue([]);
  h.sourceTagSuggestions.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SourcesPanel — collections-changed subscription teardown (#1890)', () => {
  it('unsubscribes from onCollectionsChanged when unmounted', async () => {
    // The panel lives behind a sidebar {#if} — switching tabs destroys and
    // recreates it. Before #1890 fixed onCollectionsChanged's return type to
    // () => void, the component couldn't capture (or call) the unsubscriber,
    // so every tab switch leaked another listener.
    const unsubscribe = vi.fn();
    h.sourceData.onCollectionsChanged.mockReturnValue(unsubscribe);
    const { unmount } = render(SourcesPanel, props());
    await waitFor(() => expect(h.sourceData.onCollectionsChanged).toHaveBeenCalledTimes(1));
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('SourcesPanel (baseline)', () => {
  it('renders the source list and the "All sources" count from listAll', async () => {
    render(SourcesPanel, props());
    await waitFor(() => expect(screen.getByText('The Part-Time Parliament')).toBeTruthy());
    expect(screen.getByText('In Search of an Understandable Consensus Algorithm')).toBeTruthy();
    expect(h.api.sources.listAll).toHaveBeenCalled();
    expect(h.api.collections.list).toHaveBeenCalled();
    // The "All sources" row shows the total (2).
    const allRow = screen.getByText('All sources').closest('button')!;
    expect(allRow.textContent).toContain('2');
  });

  it('renders the collection tree from collections.list', async () => {
    render(SourcesPanel, props());
    await waitFor(() => expect(screen.getByText('Consensus')).toBeTruthy());
  });

  it('routes a source row click to onSourceSelect', async () => {
    const p = props();
    render(SourcesPanel, p);
    await waitFor(() => expect(screen.getByText('The Part-Time Parliament')).toBeTruthy());
    await fireEvent.click(screen.getByText('The Part-Time Parliament'));
    expect(p.onSourceSelect).toHaveBeenCalledWith('paxos');
  });

  it('narrows the visible list with the free-text filter', async () => {
    render(SourcesPanel, props());
    await waitFor(() => expect(screen.getByText('The Part-Time Parliament')).toBeTruthy());
    await fireEvent.input(screen.getByPlaceholderText('Filter sources…'), { target: { value: 'raft' } });
    await waitFor(() => expect(screen.queryByText('The Part-Time Parliament')).toBeNull());
    expect(screen.getByText('In Search of an Understandable Consensus Algorithm')).toBeTruthy();
  });

  it('scopes the list to a collection when its row is selected', async () => {
    render(SourcesPanel, props());
    await waitFor(() => expect(screen.getByText('Consensus')).toBeTruthy());
    await fireEvent.click(screen.getByText('Consensus'));
    // Consensus contains only paxos; raft drops out of the list.
    await waitFor(() => expect(screen.queryByText('In Search of an Understandable Consensus Algorithm')).toBeNull());
    expect(screen.getByText('The Part-Time Parliament')).toBeTruthy();
  });

  it('re-queries members and shows the empty state when a queue view is selected', async () => {
    render(SourcesPanel, props());
    await waitFor(() => expect(screen.getByText('The Part-Time Parliament')).toBeTruthy());
    await fireEvent.click(screen.getByText('Unread'));
    expect(h.api.sources.queueMembers).toHaveBeenCalledWith('unread');
    // queueMembers resolves [] → the queue view is empty.
    await waitFor(() => expect(screen.getByText('Nothing in this queue view.')).toBeTruthy());
  });

  it('opens the source context menu and routes "Delete Source" through the source-actions helper', async () => {
    const p = props();
    render(SourcesPanel, p);
    await waitFor(() => expect(screen.getByText('The Part-Time Parliament')).toBeTruthy());
    await fireEvent.contextMenu(screen.getByText('The Part-Time Parliament'));
    await fireEvent.click(await screen.findByText('Delete Source'));
    expect(h.deleteSource).toHaveBeenCalledTimes(1);
    expect(h.deleteSource.mock.calls[0]![0]).toMatchObject({ sourceId: 'paxos' });
    expect(h.deleteSource.mock.calls[0]![1]).toBe(p.onShowConfirm);
  });

  it('routes "Rename…" through the source-actions helper with the host prompt', async () => {
    const p = props();
    render(SourcesPanel, p);
    await waitFor(() => expect(screen.getByText('The Part-Time Parliament')).toBeTruthy());
    await fireEvent.contextMenu(screen.getByText('The Part-Time Parliament'));
    await fireEvent.click(await screen.findByText('Rename…'));
    expect(h.renameSource).toHaveBeenCalledTimes(1);
    expect(h.renameSource.mock.calls[0]![0]).toMatchObject({ sourceId: 'paxos' });
    expect(h.renameSource.mock.calls[0]![1]).toBe(p.onShowPrompt);
  });

  it('prompts on the add-source button and ingests the entered input', async () => {
    const p = props({ onShowPrompt: vi.fn().mockResolvedValue('https://example.com/paper') });
    h.sourceData.ingestSmart.mockResolvedValue({ sourceId: 'new', title: 'New', duplicate: false });
    render(SourcesPanel, p);
    await waitFor(() => expect(screen.getByText('The Part-Time Parliament')).toBeTruthy());
    await fireEvent.click(screen.getByLabelText('Add source'));
    await waitFor(() => expect(h.sourceData.ingestSmart).toHaveBeenCalledWith('https://example.com/paper'));
    expect(p.onSourceOpened).toHaveBeenCalledWith('new');
  });
});
