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

  it('previews the first failures when some entries fail', async () => {
    const failed = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, reason: 'bad' }));
    h.api.sources.importBibtex.mockResolvedValue({
      imported: [], duplicate: [], failed, parseErrors: 2,
    });
    await ops.handleImportBibtex();
    const msg = h.dialog.showConfirm.mock.calls[0][0] as string;
    expect(msg).toContain('Failed: 7');
    expect(msg).toContain('Parse errors: 2');
    expect(msg).toContain('First failures:');
    expect(msg).toContain('…and 2 more');
  });

  it('reports the api error and does not refresh', async () => {
    h.api.sources.importBibtex.mockRejectedValue(new Error('boom'));
    await ops.handleImportBibtex();
    expect(ctx.refreshSourcesCache).not.toHaveBeenCalled();
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('boom'), expect.any(String), 'OK',
    );
  });

  it('does nothing when there is no open notebase', async () => {
    h.notebase.meta = null;
    await ops.handleImportBibtex();
    expect(h.api.sources.importBibtex).not.toHaveBeenCalled();
  });
});

describe('handleImportZoteroRdf', () => {
  it('does nothing more when the picker is cancelled', async () => {
    h.api.sources.importZoteroRdf.mockResolvedValue(null);
    await ops.handleImportZoteroRdf();
    expect(ctx.refreshSourcesCache).not.toHaveBeenCalled();
    expect(sidebar.refreshSources).not.toHaveBeenCalled();
  });

  it('refreshes and reports a successful import, counting attached PDFs', async () => {
    h.api.sources.importZoteroRdf.mockResolvedValue({
      imported: [{ pdfAttached: true }, { pdfAttached: false }],
      duplicate: [{}], failed: [],
    });
    await ops.handleImportZoteroRdf();
    expect(sidebar.refreshSources).toHaveBeenCalled();
    expect(ctx.refreshSourcesCache).toHaveBeenCalled();
    const msg = h.dialog.showConfirm.mock.calls[0][0] as string;
    expect(msg).toContain('Imported: 2 (1 with PDF)');
    expect(msg).toContain('Duplicate (skipped): 1');
  });

  it('previews the first failures when some entries fail', async () => {
    const failed = Array.from({ length: 6 }, (_, i) => ({ subject: `s${i}`, reason: 'nope' }));
    h.api.sources.importZoteroRdf.mockResolvedValue({
      imported: [], duplicate: [], failed,
    });
    await ops.handleImportZoteroRdf();
    const msg = h.dialog.showConfirm.mock.calls[0][0] as string;
    expect(msg).toContain('Failed: 6');
    expect(msg).toContain('First failures:');
    expect(msg).toContain('…and 1 more');
  });

  it('reports the api error', async () => {
    h.api.sources.importZoteroRdf.mockRejectedValue(new Error('rdf-boom'));
    await ops.handleImportZoteroRdf();
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('rdf-boom'), expect.any(String), 'OK',
    );
  });

  it('does nothing when there is no open notebase', async () => {
    h.notebase.meta = null;
    await ops.handleImportZoteroRdf();
    expect(h.api.sources.importZoteroRdf).not.toHaveBeenCalled();
  });
});

describe('handleIngestUrlAsSource (extra branches)', () => {
  it('does nothing when there is no open notebase', async () => {
    h.notebase.meta = null;
    await ops.handleIngestUrlAsSource();
    expect(h.dialog.showPrompt).not.toHaveBeenCalled();
  });

  it('does nothing when the prompt is dismissed (null)', async () => {
    h.dialog.showPrompt.mockResolvedValue(null);
    await ops.handleIngestUrlAsSource();
    expect(h.api.sources.ingestUrl).not.toHaveBeenCalled();
  });

  it('does nothing when the URL is only whitespace', async () => {
    h.dialog.showPrompt.mockResolvedValue('   ');
    await ops.handleIngestUrlAsSource();
    expect(h.api.sources.ingestUrl).not.toHaveBeenCalled();
  });

  it('trims the prompted URL before ingesting', async () => {
    h.dialog.showPrompt.mockResolvedValue('  https://ex.com/z  ');
    h.api.sources.ingestUrl.mockResolvedValue({ sourceId: 's', title: 'T', duplicate: false });
    await ops.handleIngestUrlAsSource();
    expect(h.api.sources.ingestUrl).toHaveBeenCalledWith('https://ex.com/z');
  });

  it('reports an ingest failure via confirm', async () => {
    h.dialog.showPrompt.mockResolvedValue('https://ex.com/bad');
    h.api.sources.ingestUrl.mockRejectedValue(new Error('net down'));
    await ops.handleIngestUrlAsSource();
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('net down'), expect.any(String), 'OK',
    );
  });
});

describe('handleIngestFileAsSource', () => {
  it('does nothing when there is no open notebase', async () => {
    h.notebase.meta = null;
    await ops.handleIngestFileAsSource();
    expect(h.api.sources.ingestFile).not.toHaveBeenCalled();
  });

  it('does nothing more when the picker is cancelled', async () => {
    h.api.sources.ingestFile.mockResolvedValue(null);
    await ops.handleIngestFileAsSource();
    expect(ctx.openSource).not.toHaveBeenCalled();
    expect(flow.ocrSession).toBeNull();
  });

  it('opens a plain ingested source after the settle delay', async () => {
    vi.useFakeTimers();
    h.api.sources.ingestFile.mockResolvedValue({ sourceId: 'f1', title: 'Doc', duplicate: false });
    await ops.handleIngestFileAsSource();
    vi.advanceTimersByTime(200);
    expect(ctx.openSource).toHaveBeenCalledWith('f1');
  });

  it('routes a scanned PDF into the OCR flow', async () => {
    const bytes = new Uint8Array([9]);
    h.api.sources.readPdf.mockResolvedValue(bytes);
    h.api.sources.ingestFile.mockResolvedValue({
      sourceId: 'f2', title: 'Scan', duplicate: false, needsOcr: true, pageCount: 3,
    });
    await ops.handleIngestFileAsSource();
    expect(flow.ocrSession).toEqual({ sourceId: 'f2', title: 'Scan', pageCount: 3 });
    expect(flow.ocrPdfBytes).toBe(bytes);
  });

  it('reports an ingest failure via confirm', async () => {
    h.api.sources.ingestFile.mockRejectedValue(new Error('read err'));
    await ops.handleIngestFileAsSource();
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('read err'), expect.any(String), 'OK',
    );
  });
});

describe('handleIngestedSourceResult (plain + defaults)', () => {
  it('defaults pageCount to 0 when needsOcr with no page count', async () => {
    h.api.sources.readPdf.mockResolvedValue(new Uint8Array());
    await ops.handleIngestedSourceResult({ sourceId: 's', title: 'T', duplicate: false, needsOcr: true });
    expect(flow.ocrSession).toEqual({ sourceId: 's', title: 'T', pageCount: 0 });
  });

  it('opens the tab for a plain result', async () => {
    vi.useFakeTimers();
    await ops.handleIngestedSourceResult({ sourceId: 'plain', title: 'P', duplicate: false });
    vi.advanceTimersByTime(200);
    expect(ctx.openSource).toHaveBeenCalledWith('plain');
  });

  it('falls back to sourceId in the duplicate message when title is empty', async () => {
    await ops.handleIngestedSourceResult({ sourceId: 'onlyid', title: '', duplicate: true });
    expect(h.dialog.showConfirm.mock.calls[0][0]).toContain('onlyid');
  });
});

describe('handleIngestIdentifier', () => {
  it('does nothing when there is no open notebase', async () => {
    h.notebase.meta = null;
    await ops.handleIngestIdentifier();
    expect(h.dialog.showPrompt).not.toHaveBeenCalled();
  });

  it('does nothing on an empty/whitespace identifier', async () => {
    h.dialog.showPrompt.mockResolvedValue('  ');
    await ops.handleIngestIdentifier();
    expect(h.api.sources.ingestIdentifier).not.toHaveBeenCalled();
  });

  it('looks up a trimmed identifier and opens the source', async () => {
    vi.useFakeTimers();
    h.dialog.showPrompt.mockResolvedValue(' 10.1/abc ');
    h.api.sources.ingestIdentifier.mockResolvedValue({ sourceId: 'i1', title: 'T', duplicate: false });
    await ops.handleIngestIdentifier();
    expect(h.api.sources.ingestIdentifier).toHaveBeenCalledWith('10.1/abc');
    vi.advanceTimersByTime(200);
    expect(ctx.openSource).toHaveBeenCalledWith('i1');
  });

  it('confirms a duplicate after opening it', async () => {
    h.dialog.showPrompt.mockResolvedValue('10.1/dup');
    h.api.sources.ingestIdentifier.mockResolvedValue({ sourceId: 'i2', title: 'Dup', duplicate: true });
    await ops.handleIngestIdentifier();
    expect(h.dialog.showConfirm.mock.calls[0][0]).toContain('Already ingested');
  });

  it('warns when the open-access PDF fetch failed', async () => {
    h.dialog.showPrompt.mockResolvedValue('10.1/pdf');
    h.api.sources.ingestIdentifier.mockResolvedValue({
      sourceId: 'i3', title: 'Paper', duplicate: false, pdfError: 'HTTP 403',
    });
    await ops.handleIngestIdentifier();
    expect(h.dialog.showConfirm.mock.calls[0][0]).toContain('HTTP 403');
  });

  it('reports a lookup failure via confirm', async () => {
    h.dialog.showPrompt.mockResolvedValue('10.1/err');
    h.api.sources.ingestIdentifier.mockRejectedValue(new Error('lookup boom'));
    await ops.handleIngestIdentifier();
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('lookup boom'), expect.any(String), 'OK',
    );
  });
});

describe('handleOcrDone (extra branches)', () => {
  it('does nothing when there is no active OCR session', async () => {
    await ops.handleOcrDone(['x']);
    expect(h.api.sources.finishPdfOcr).not.toHaveBeenCalled();
  });

  it('reports a save failure and does not open the tab', async () => {
    vi.useFakeTimers();
    flow.setOcrSession({ sourceId: 's9', title: 'T', pageCount: 1 });
    h.api.sources.finishPdfOcr.mockRejectedValue(new Error('save boom'));
    await ops.handleOcrDone(['p']);
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('save boom'), expect.any(String), 'OK',
    );
    vi.advanceTimersByTime(200);
    expect(ctx.openSource).not.toHaveBeenCalled();
  });
});

describe('handleOcrCancel', () => {
  it('does nothing when there is no active OCR session', () => {
    ops.handleOcrCancel();
    expect(ctx.openSource).not.toHaveBeenCalled();
  });

  it('clears the session and opens the source tab', () => {
    vi.useFakeTimers();
    flow.setOcrSession({ sourceId: 's10', title: 'T', pageCount: 2 });
    flow.setOcrPdfBytes(new Uint8Array([1]));
    ops.handleOcrCancel();
    expect(flow.ocrSession).toBeNull();
    expect(flow.ocrPdfBytes).toBeNull();
    vi.advanceTimersByTime(200);
    expect(ctx.openSource).toHaveBeenCalledWith('s10');
  });
});

describe('handleMineReferences (error branch)', () => {
  it('reports a mining failure via confirm and leaves review null', async () => {
    h.api.sources.mineReferences.mockRejectedValue(new Error('mine boom'));
    await ops.handleMineReferences({ sourceId: 'p', title: 'T' } as never);
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('mine boom'), expect.any(String), 'OK',
    );
    expect(flow.mineReview).toBeNull();
  });

  it('falls back to sourceId for the parent title when unset', async () => {
    h.api.sources.mineReferences.mockResolvedValue([{ raw: 'a' }]);
    await ops.handleMineReferences({ sourceId: 'p3' } as never);
    expect(flow.mineReview?.parentTitle).toBe('p3');
  });
});

describe('handleMineReferencesApply', () => {
  it('does nothing when there is no active review state', async () => {
    flow.setMineReview(null);
    await ops.handleMineReferencesApply([{ raw: 'a' } as never]);
    expect(h.api.sources.createReferenceStubs).not.toHaveBeenCalled();
  });

  it('creates stubs for the parent and reports the outcome', async () => {
    flow.setMineReview({ parentId: 'par', parentTitle: 'Par', refs: [] });
    h.api.sources.createReferenceStubs.mockResolvedValue({
      created: [{}, {}], matchedExisting: [{}], skipped: [{}],
    });
    const accepted = [{ raw: 'r1' }] as never;
    await ops.handleMineReferencesApply(accepted);
    expect(h.api.sources.createReferenceStubs).toHaveBeenCalledWith('par', accepted);
    expect(ctx.refreshSourcesCache).toHaveBeenCalled();
    expect(flow.mineReview).toBeNull();
    const msg = h.dialog.showConfirm.mock.calls[0][0] as string;
    expect(msg).toContain('Created 2 new stubs.');
    expect(msg).toContain('1 matched existing sources.');
    expect(msg).toContain('1 skipped (id collision).');
  });

  it('uses singular wording for a single created stub', async () => {
    flow.setMineReview({ parentId: 'par', parentTitle: 'Par', refs: [] });
    h.api.sources.createReferenceStubs.mockResolvedValue({
      created: [{}], matchedExisting: [], skipped: [],
    });
    await ops.handleMineReferencesApply([]);
    expect(h.dialog.showConfirm.mock.calls[0][0]).toContain('Created 1 new stub.');
  });

  it('shows no confirm when nothing changed', async () => {
    flow.setMineReview({ parentId: 'par', parentTitle: 'Par', refs: [] });
    h.api.sources.createReferenceStubs.mockResolvedValue({
      created: [], matchedExisting: [], skipped: [],
    });
    await ops.handleMineReferencesApply([]);
    expect(h.dialog.showConfirm).not.toHaveBeenCalled();
  });

  it('reports a stub-creation failure via confirm', async () => {
    flow.setMineReview({ parentId: 'par', parentTitle: 'Par', refs: [] });
    h.api.sources.createReferenceStubs.mockRejectedValue(new Error('stub boom'));
    await ops.handleMineReferencesApply([]);
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('stub boom'), expect.any(String), 'OK',
    );
  });
});

describe('handleResolveStub (extra branches)', () => {
  it('does nothing when there is no open notebase', async () => {
    h.notebase.meta = null;
    await ops.handleResolveStub('s');
    expect(h.api.sources.resolveStub).not.toHaveBeenCalled();
  });

  it('reports a CrossRef search failure via confirm', async () => {
    h.api.sources.resolveStub.mockRejectedValue(new Error('crossref boom'));
    await ops.handleResolveStub('s');
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('crossref boom'), expect.any(String), 'OK',
    );
  });

  it('confirms when CrossRef returns no candidates', async () => {
    h.api.sources.resolveStub.mockResolvedValue([]);
    await ops.handleResolveStub('s');
    expect(h.dialog.showConfirm.mock.calls[0][0]).toContain('CrossRef returned no matches');
    expect(flow.resolveStub).toBeNull();
  });

  it('auto-apply reports success and refreshes the cache', async () => {
    h.api.sources.resolveStub.mockResolvedValue([
      { doi: '10.1/hi', title: 'Match', confidence: 0.9 },
    ]);
    await ops.handleResolveStub('sX');
    expect(h.api.sources.applyStubResolution).toHaveBeenCalledWith('sX', '10.1/hi');
    expect(ctx.refreshSourcesCache).toHaveBeenCalled();
    expect(h.dialog.showConfirm.mock.calls[0][0]).toContain('Resolved to "Match"');
  });

  it('reports a failure when auto-apply of the resolution throws', async () => {
    h.api.sources.resolveStub.mockResolvedValue([
      { doi: '10.1/hi', title: 'Match', confidence: 0.9 },
    ]);
    h.api.sources.applyStubResolution.mockRejectedValue(new Error('apply boom'));
    await ops.handleResolveStub('sY');
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('apply boom'), expect.any(String), 'OK',
    );
  });

  it('uses the sourceId as picker title when no detail is available', async () => {
    h.api.sources.resolveStub.mockResolvedValue([
      { doi: '10.1/lo', title: 'Maybe', confidence: 0.4 },
    ]);
    h.api.graph.sourceDetail.mockResolvedValue(null);
    await ops.handleResolveStub('sZ');
    expect(flow.resolveStub?.stubTitle).toBe('sZ');
  });
});

describe('handleResolveStubApply', () => {
  it('does nothing when there is no active resolve state', async () => {
    flow.setResolveStub(null);
    await ops.handleResolveStubApply('10.1/x');
    expect(h.api.sources.applyStubResolution).not.toHaveBeenCalled();
  });

  it('applies the picked candidate and clears the state', async () => {
    h.api.sources.applyStubResolution.mockResolvedValue(undefined);
    flow.setResolveStub({
      sourceId: 'src', stubTitle: 'Stub',
      candidates: [{ doi: '10.1/a', title: 'Picked' } as never],
    });
    await ops.handleResolveStubApply('10.1/a');
    expect(h.api.sources.applyStubResolution).toHaveBeenCalledWith('src', '10.1/a');
    expect(flow.resolveStub).toBeNull();
    expect(h.dialog.showConfirm.mock.calls[0][0]).toContain('Picked');
  });

  it('falls back to the stub title when the doi is not among candidates', async () => {
    h.api.sources.applyStubResolution.mockResolvedValue(undefined);
    flow.setResolveStub({ sourceId: 'src', stubTitle: 'StubTitle', candidates: [] });
    await ops.handleResolveStubApply('10.1/missing');
    expect(h.api.sources.applyStubResolution).toHaveBeenCalledWith('src', '10.1/missing');
    expect(h.dialog.showConfirm.mock.calls[0][0]).toContain('StubTitle');
  });
});

describe('handleDoiClick', () => {
  it('does nothing when there is no open notebase', async () => {
    h.notebase.meta = null;
    await ops.handleDoiClick('10.1/x');
    expect(ctx.findSourceByDoi).not.toHaveBeenCalled();
  });

  it('opens an already-ingested source (case-folding the DOI) without prompting', async () => {
    ctx.findSourceByDoi = vi.fn(() => ({ sourceId: 'have-it' }));
    await ops.handleDoiClick('10.1/ABC');
    expect(ctx.findSourceByDoi).toHaveBeenCalledWith('10.1/abc');
    expect(ctx.openSource).toHaveBeenCalledWith('have-it');
    expect(h.dialog.showConfirm).not.toHaveBeenCalled();
  });

  it('does nothing when the ingest confirmation is declined', async () => {
    ctx.findSourceByDoi = vi.fn(() => undefined);
    h.dialog.showConfirm.mockResolvedValue(false);
    await ops.handleDoiClick('10.1/new');
    expect(h.api.sources.ingestIdentifier).not.toHaveBeenCalled();
  });

  it('ingests and opens the source when confirmed', async () => {
    vi.useFakeTimers();
    ctx.findSourceByDoi = vi.fn(() => undefined);
    h.dialog.showConfirm.mockResolvedValue(true);
    h.api.sources.ingestIdentifier.mockResolvedValue({ sourceId: 'doi-src' });
    await ops.handleDoiClick('10.1/new');
    expect(h.api.sources.ingestIdentifier).toHaveBeenCalledWith('10.1/new');
    vi.advanceTimersByTime(200);
    expect(ctx.openSource).toHaveBeenCalledWith('doi-src');
  });

  it('reports an ingest failure via confirm', async () => {
    ctx.findSourceByDoi = vi.fn(() => undefined);
    h.dialog.showConfirm.mockResolvedValueOnce(true).mockResolvedValue(undefined);
    h.api.sources.ingestIdentifier.mockRejectedValue(new Error('doi boom'));
    await ops.handleDoiClick('10.1/new');
    expect(h.dialog.showConfirm).toHaveBeenLastCalledWith(
      expect.stringContaining('doi boom'), expect.any(String), 'OK',
    );
  });
});

describe('handleExternalDrop', () => {
  it('does nothing when there is no open notebase', async () => {
    h.notebase.meta = null;
    await ops.handleExternalDrop('/dest', [] as unknown as FileList);
    expect(h.api.files.dropImport).not.toHaveBeenCalled();
  });

  it('does nothing when no local paths resolve', async () => {
    h.api.files.getPathForFile.mockReturnValue(undefined);
    await ops.handleExternalDrop('/dest', ['a'] as unknown as FileList);
    expect(h.api.files.dropImport).not.toHaveBeenCalled();
  });

  it('imports resolved paths and opens the first non-duplicate PDF', async () => {
    vi.useFakeTimers();
    h.api.files.getPathForFile.mockImplementation((f: string) => `/abs/${f}`);
    h.api.files.dropImport.mockResolvedValue({
      ingestedPdfs: [{ sourceId: 'dup', duplicate: true }, { sourceId: 'fresh', duplicate: false }],
      rejected: [],
    });
    await ops.handleExternalDrop('/dest', ['x.pdf', 'y.pdf'] as unknown as FileList);
    expect(h.api.files.dropImport).toHaveBeenCalledWith('/dest', ['/abs/x.pdf', '/abs/y.pdf']);
    vi.advanceTimersByTime(200);
    expect(ctx.openSource).toHaveBeenCalledWith('fresh');
  });

  it('falls back to the first PDF when all are duplicates', async () => {
    vi.useFakeTimers();
    h.api.files.getPathForFile.mockReturnValue('/abs/z.pdf');
    h.api.files.dropImport.mockResolvedValue({
      ingestedPdfs: [{ sourceId: 'only-dup', duplicate: true }],
      rejected: [],
    });
    await ops.handleExternalDrop('/dest', ['z.pdf'] as unknown as FileList);
    vi.advanceTimersByTime(200);
    expect(ctx.openSource).toHaveBeenCalledWith('only-dup');
  });

  it('reports rejected files via confirm', async () => {
    h.api.files.getPathForFile.mockReturnValue('/abs/bad.txt');
    h.api.files.dropImport.mockResolvedValue({
      ingestedPdfs: [],
      rejected: [{ localPath: '/some/bad.txt', reason: 'unsupported' }],
    });
    await ops.handleExternalDrop('/dest', ['bad.txt'] as unknown as FileList);
    const msg = h.dialog.showConfirm.mock.calls[0][0] as string;
    expect(msg).toContain('bad.txt');
    expect(msg).toContain('unsupported');
  });

  it('reports an import failure via confirm', async () => {
    h.api.files.getPathForFile.mockReturnValue('/abs/x.pdf');
    h.api.files.dropImport.mockRejectedValue(new Error('drop boom'));
    await ops.handleExternalDrop('/dest', ['x.pdf'] as unknown as FileList);
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('drop boom'), expect.any(String), 'OK',
    );
  });
});
