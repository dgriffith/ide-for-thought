/**
 * @vitest-environment happy-dom
 *
 * SourceDetail render test (#1597). SourceDetail is the second-largest renderer
 * file and a gated LLM write surface (propose_source_properties → meta.ttl), but
 * had only its extracted `source-actions` logic covered. This mounts the real
 * component against mocked IPC + stores and asserts the metadata display and the
 * read-status / rename / delete / source-tools wiring. The source body is absent
 * (meta-only source), so the heavy Preview child never mounts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';
import type { SourceDetail as SourceDetailData, SourceMetadata } from '../../../src/shared/types';
import type { ThinkingToolInfo } from '../../../src/shared/tools/types';

const metadata: SourceMetadata = {
  sourceId: 'paxos', subtype: 'article', title: 'The Part-Time Parliament',
  creators: ['Lamport, Leslie'], year: '1998', publisher: null, doi: null, uri: null,
  abstract: null, readStatus: null, readDueBy: null, stubStatus: null, tags: [],
};
const detail: SourceDetailData = { metadata, excerpts: [], backlinks: [], aboutNotes: [], references: [] };

// A source with all three navigable lists populated, to exercise the extracted
// NavList / SourceLinkRow rows and their click-to-navigate wiring (#1628).
const withLists: SourceDetailData = {
  metadata,
  excerpts: [],
  aboutNotes: [{ relativePath: 'notes/about-paxos.md', title: 'About Paxos' }],
  references: [
    { sourceId: 'lamport-clocks', title: 'Time, Clocks', stubStatus: null },
    { sourceId: 'ghost-ref', title: 'Unresolved Ref', stubStatus: 'unresolved' },
  ],
  backlinks: [
    { relativePath: 'notes/cites-paxos.md', title: 'Cites Paxos', kind: 'cite' },
    { relativePath: 'notes/quotes-paxos.md', title: 'Quotes Paxos', kind: 'quote', viaExcerptId: 'exc-1' },
  ],
};

const h = vi.hoisted(() => ({
  api: {
    graph: { sourceDetail: vi.fn() },
    notebase: { readFile: vi.fn() },
    sources: { hasPdf: vi.fn() },
    shell: { openExternal: vi.fn() },
  },
  sourceData: {
    setReadStatus: vi.fn(),
    setReadDueBy: vi.fn(),
    removeTag: vi.fn(),
    createExcerpt: vi.fn(),
    onExcerptsChanged: vi.fn(() => () => {}), // returns an unsubscribe
  },
  notebase: { readFile: vi.fn(), writeFile: vi.fn() },
  dialogs: {
    showConfirm: vi.fn().mockResolvedValue(true),
    showPrompt: vi.fn().mockResolvedValue(null),
  },
  renameSource: vi.fn(),
  deleteSource: vi.fn(),
  addSourceTag: vi.fn(),
  sourceTagSuggestions: vi.fn(),
  getAllToolInfos: vi.fn(() => [] as ThinkingToolInfo[]),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/source-data.svelte', () => ({ getSourceDataStore: () => h.sourceData }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialogs }));
vi.mock('../../../src/renderer/lib/sources/source-actions', () => ({
  renameSource: h.renameSource,
  deleteSource: h.deleteSource,
  addSourceTag: h.addSourceTag,
  sourceTagSuggestions: h.sourceTagSuggestions,
}));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({ getAllToolInfos: h.getAllToolInfos }));

import SourceDetail from '../../../src/renderer/lib/components/SourceDetail.svelte';

function props(opsOver: Record<string, unknown> = {}) {
  return {
    sourceId: 'paxos',
    ops: {
      onNavigate: vi.fn(),
      onDeleted: vi.fn(),
      ...opsOver,
    },
  };
}

beforeEach(() => {
  h.api.graph.sourceDetail.mockResolvedValue(detail);
  h.api.notebase.readFile.mockRejectedValue(new Error('meta-only source, no body.md'));
  h.api.sources.hasPdf.mockResolvedValue(false);
  h.sourceData.setReadStatus.mockResolvedValue(undefined);
  h.sourceTagSuggestions.mockResolvedValue([]);
  h.getAllToolInfos.mockReturnValue([]);
  h.dialogs.showConfirm.mockResolvedValue(true);
  h.dialogs.showPrompt.mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SourceDetail (#1597)', () => {
  it('loads and displays the source metadata', async () => {
    render(SourceDetail, props());
    await waitFor(() => expect(screen.getByText('The Part-Time Parliament')).toBeTruthy());
    expect(h.api.graph.sourceDetail).toHaveBeenCalledWith('paxos');
  });

  it('wires the read-status buttons to the source-data store', async () => {
    render(SourceDetail, props());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unread' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Unread' }));
    // readStatus started null, so clicking "Unread" sets it.
    expect(h.sourceData.setReadStatus).toHaveBeenCalledWith('paxos', 'unread');
  });

  it('routes "Rename source" through the source-actions helper with the dialogs store prompt', async () => {
    const p = props();
    render(SourceDetail, p);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename source' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Rename source' }));
    expect(h.renameSource).toHaveBeenCalledTimes(1);
    expect(h.renameSource.mock.calls[0]![0]).toMatchObject({ sourceId: 'paxos' }); // the loaded metadata
    expect(h.renameSource.mock.calls[0]![1]).toBe(h.dialogs.showPrompt);
  });

  it('routes "Delete source" through the source-actions helper with the dialogs store confirm', async () => {
    const p = props();
    render(SourceDetail, p);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete source' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Delete source' }));
    expect(h.deleteSource).toHaveBeenCalledTimes(1);
    expect(h.deleteSource.mock.calls[0]![0]).toMatchObject({ sourceId: 'paxos' });
    expect(h.deleteSource.mock.calls[0]![1]).toBe(h.dialogs.showConfirm);
  });

  it('surfaces the source Tools entry point when a source-scoped tool + onInvokeTool exist', async () => {
    h.getAllToolInfos.mockReturnValue([{
      id: 'summarize-source', name: 'Summarize Source', category: 'research', scope: 'source',
      description: '', longDescription: '', context: [], outputMode: 'note',
    } as ThinkingToolInfo]);
    render(SourceDetail, props({ onInvokeTool: vi.fn() }));
    await waitFor(() => expect(screen.getByText('The Part-Time Parliament')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Tools/ })).toBeTruthy();
  });

  describe('navigable lists (NavList / SourceLinkRow, #1628)', () => {
    it('renders the notes / references / backlinks rows and routes each click to navigate', async () => {
      h.api.graph.sourceDetail.mockResolvedValue(withLists);
      const p = props({ onOpenReference: vi.fn() });
      render(SourceDetail, p);

      // An "about" note routes through onNavigate with its path.
      await waitFor(() => expect(screen.getByText('About Paxos')).toBeTruthy());
      await fireEvent.click(screen.getByText('About Paxos'));
      expect(p.ops.onNavigate).toHaveBeenCalledWith('notes/about-paxos.md');

      // A reference routes through onOpenReference with its sourceId.
      await fireEvent.click(screen.getByText('Time, Clocks'));
      expect(p.ops.onOpenReference).toHaveBeenCalledWith('lamport-clocks');

      // A backlink routes through onNavigate with its path.
      await fireEvent.click(screen.getByText('Quotes Paxos'));
      expect(p.ops.onNavigate).toHaveBeenCalledWith('notes/quotes-paxos.md');
    });

    it('marks an unresolved reference with a stub badge', async () => {
      h.api.graph.sourceDetail.mockResolvedValue(withLists);
      render(SourceDetail, props({ onOpenReference: vi.fn() }));
      await waitFor(() => expect(screen.getByText('Unresolved Ref')).toBeTruthy());
      expect(screen.getByText('stub')).toBeTruthy();
    });

    it('shows the backlink kind label and via-excerpt id', async () => {
      h.api.graph.sourceDetail.mockResolvedValue(withLists);
      render(SourceDetail, props({ onOpenReference: vi.fn() }));
      await waitFor(() => expect(screen.getByText('Cites Paxos')).toBeTruthy());
      // kind → 'cites' / 'quotes', plus the excerpt id on the quote backlink.
      expect(screen.getByText('cites')).toBeTruthy();
      expect(screen.getByText('quotes')).toBeTruthy();
      expect(screen.getByText('exc-1')).toBeTruthy();
    });
  });
});
