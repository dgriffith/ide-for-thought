/**
 * Behavioral net for the source-ops handlers extracted from App.svelte (#670).
 * Mocks the api client + notebase/dialog stores; uses the real busy +
 * source-flow runes stores. Verifies the moved handler bodies (ingest, OCR,
 * reference mining, stub resolution), not just that menus reach them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const api = {
    sources: {
      ingestUrl: vi.fn(), ingestFile: vi.fn(), ingestIdentifier: vi.fn(),
      readPdf: vi.fn(), finishPdfOcr: vi.fn(), mineReferences: vi.fn(),
      createReferenceStubs: vi.fn(), resolveStub: vi.fn(), applyStubResolution: vi.fn(),
      importBibtex: vi.fn(), importZoteroRdf: vi.fn(),
    },
    files: { getPathForFile: vi.fn(), dropImport: vi.fn() },
    graph: { sourceDetail: vi.fn() },
  };
  const notebase = { meta: { rootPath: '/p', name: 'p' } as unknown };
  const dialog = { showPrompt: vi.fn(), showConfirm: vi.fn() };
  return { api, notebase, dialog };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialog }));

import { createSourceOps, type SourceOpsCtx } from '../../../src/renderer/lib/app/source-ops';
import { getSourceFlowStore } from '../../../src/renderer/lib/stores/source-flow.svelte';

const flow = getSourceFlowStore();
const sidebar = { refreshSources: vi.fn() };
let ctx: SourceOpsCtx;
let ops: ReturnType<typeof createSourceOps>;

function resetFlow() {
  flow.setOcrSession(null);
  flow.setOcrPdfBytes(null);
  flow.setMineReview(null);
  flow.setResolveStub(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.notebase.meta = { rootPath: '/p', name: 'p' };
  resetFlow();
  ctx = {
    openSource: vi.fn(),
    getSidebar: () => sidebar,
    refreshSourcesCache: vi.fn().mockResolvedValue(undefined),
    findSourceByDoi: vi.fn(() => undefined),
  };
  ops = createSourceOps(ctx);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handleIngestUrlAsSource', () => {
  it('ingests the prompted URL and routes a plain result to openSource', async () => {
    vi.useFakeTimers();
    h.dialog.showPrompt.mockResolvedValue('https://example.com/x');
    h.api.sources.ingestUrl.mockResolvedValue({
      sourceId: 's1', title: 'X', duplicate: false,
    });
    await ops.handleIngestUrlAsSource();
    expect(h.api.sources.ingestUrl).toHaveBeenCalledWith('https://example.com/x');
    expect(flow.ocrSession).toBeNull();
    vi.advanceTimersByTime(200);
    expect(ctx.openSource).toHaveBeenCalledWith('s1');
  });

  it('does nothing on an empty prompt', async () => {
    h.dialog.showPrompt.mockResolvedValue('');
    await ops.handleIngestUrlAsSource();
    expect(h.api.sources.ingestUrl).not.toHaveBeenCalled();
  });
});

describe('handleIngestedSourceResult', () => {
  it('needsOcr opens the OCR session and loads the PDF bytes instead of the tab', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    h.api.sources.readPdf.mockResolvedValue(bytes);
    await ops.handleIngestedSourceResult({
      sourceId: 's2', title: 'Scan', duplicate: false, needsOcr: true, pageCount: 4,
    });
    expect(flow.ocrSession).toEqual({ sourceId: 's2', title: 'Scan', pageCount: 4 });
    expect(flow.ocrPdfBytes).toBe(bytes);
    expect(h.api.sources.readPdf).toHaveBeenCalledWith('s2');
    expect(ctx.openSource).not.toHaveBeenCalled();
  });

  it('duplicate result confirms (and does not open OCR)', async () => {
    await ops.handleIngestedSourceResult({ sourceId: 's3', title: 'Dup', duplicate: true });
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(flow.ocrSession).toBeNull();
  });
});

describe('handleOcrDone', () => {
  it('finishes OCR for the active session and clears it', async () => {
    vi.useFakeTimers();
    flow.setOcrSession({ sourceId: 's4', title: 'T', pageCount: 1 });
    flow.setOcrPdfBytes(new Uint8Array());
    await ops.handleOcrDone(['page one']);
    expect(h.api.sources.finishPdfOcr).toHaveBeenCalledWith('s4', ['page one']);
    expect(flow.ocrSession).toBeNull();
    expect(flow.ocrPdfBytes).toBeNull();
    vi.advanceTimersByTime(200);
    expect(ctx.openSource).toHaveBeenCalledWith('s4');
  });
});

describe('handleMineReferences', () => {
  it('sets the review state when refs come back', async () => {
    h.api.sources.mineReferences.mockResolvedValue([{ raw: 'a' }, { raw: 'b' }]);
    await ops.handleMineReferences({ sourceId: 'p1', title: 'Parent' } as never);
    expect(flow.mineReview).toEqual({
      parentId: 'p1', parentTitle: 'Parent', refs: [{ raw: 'a' }, { raw: 'b' }],
    });
  });

  it('shows a notice and leaves review state null when no refs parse', async () => {
    h.api.sources.mineReferences.mockResolvedValue([]);
    await ops.handleMineReferences({ sourceId: 'p2', title: 'Parent' } as never);
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(flow.mineReview).toBeNull();
  });
});

describe('handleResolveStub', () => {
  it('auto-applies when the top candidate clears the confidence threshold', async () => {
    h.api.sources.resolveStub.mockResolvedValue([
      { doi: '10.1/x', title: 'Match', confidence: 0.95 },
    ]);
    await ops.handleResolveStub('stub1');
    expect(h.api.sources.applyStubResolution).toHaveBeenCalledWith('stub1', '10.1/x');
    expect(flow.resolveStub).toBeNull();
  });

  it('opens the picker when the top candidate is below threshold', async () => {
    h.api.sources.resolveStub.mockResolvedValue([
      { doi: '10.1/y', title: 'Maybe', confidence: 0.5 },
    ]);
    h.api.graph.sourceDetail.mockResolvedValue({ metadata: { title: 'Stub' } });
    await ops.handleResolveStub('stub2');
    expect(h.api.sources.applyStubResolution).not.toHaveBeenCalled();
    expect(flow.resolveStub?.sourceId).toBe('stub2');
    expect(flow.resolveStub?.candidates).toHaveLength(1);
  });
});

describe('handleImportBibtex', () => {
  it('does nothing more when the picker is cancelled', async () => {
    h.api.sources.importBibtex.mockResolvedValue(null);
    await ops.handleImportBibtex();
    expect(ctx.refreshSourcesCache).not.toHaveBeenCalled();
    expect(sidebar.refreshSources).not.toHaveBeenCalled();
  });

  it('refreshes and reports on a successful import', async () => {
    h.api.sources.importBibtex.mockResolvedValue({
      imported: [{}], duplicate: [], failed: [], parseErrors: 0,
    });
    await ops.handleImportBibtex();
    expect(sidebar.refreshSources).toHaveBeenCalled();
    expect(ctx.refreshSourcesCache).toHaveBeenCalled();
    expect(h.dialog.showConfirm).toHaveBeenCalled();
  });
});
