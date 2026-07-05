/**
 * Source-ops handler cluster extracted from App.svelte (#670). Source ingest
 * (URL / file / identifier / external drop / DOI-click), the OCR flow (#95),
 * reference mining (#106), and stub resolution (#107). Bodies are verbatim
 * from App.svelte; the only changes are the store / ctx substitutions for the
 * pieces that used to be inline component refs, local `$state`, or sibling
 * function declarations that stay in App (the source *view* handlers).
 */
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { getDialogStore } from '../stores/dialogs.svelte';
import { getBusyStore } from '../stores/busy.svelte';
import { getSourceFlowStore } from '../stores/source-flow.svelte';
import { displaySourceTitle } from '../../../shared/source-display';
import { RESOLVE_AUTO_THRESHOLD } from '../../../shared/resolve-stub';
import { CONFIRM_KEYS } from '../confirm-keys';
import type { ParsedReference } from '../../../shared/mine-references';
import type { ResolveCandidate } from '../../../shared/resolve-stub';
import type { SourceMetadata } from '../../../shared/types';

export interface SourceOpsCtx {
  openSource: (sourceId: string, highlightExcerptId?: string) => void;
  getSidebar: () => { refreshSources: () => void } | undefined;
  refreshSourcesCache: () => Promise<void>;
  findSourceByDoi: (doiLower: string) => { sourceId: string } | undefined;
}

export function createSourceOps(ctx: SourceOpsCtx) {
  const notebase = getNotebaseStore();
  const dialogs = getDialogStore();
  const busy = getBusyStore();
  const flow = getSourceFlowStore();
  const { showPrompt, showConfirm } = dialogs;

  /**
   * Open a source tab, but only after the file watcher's `indexSource` pass has
   * had a beat to land — otherwise the detail panel's graph query returns empty
   * and the tab renders as "unknown source." `WATCHER_SETTLE_MS` is the settle
   * delay every ingest path shares (#988).
   */
  const WATCHER_SETTLE_MS = 150;
  function openSourceAfterIndex(sourceId: string): void {
    setTimeout(() => ctx.openSource(sourceId), WATCHER_SETTLE_MS);
  }

  /**
   * Shared completion for "Ingest URL/File as Source". A URL or file can resolve
   * to a web page, a PDF (possibly needing OCR), or a text doc — branch on the
   * result the same way regardless of where it came from.
   */
  async function handleIngestedSourceResult(
    result: { sourceId: string; title: string; duplicate: boolean; needsOcr?: boolean; pageCount?: number },
  ) {
    if (result.duplicate) {
      openSourceAfterIndex(result.sourceId);
      await showConfirm(
        `Already ingested: "${result.title || result.sourceId}". Opened the existing source.`,
        CONFIRM_KEYS.ingestDuplicate,
        'OK',
      );
      return;
    }
    if (result.needsOcr) {
      // Scanned PDF (from a file or a URL) — meta.ttl + original.pdf are
      // persisted but body.md is empty until OCR runs (#95). Defer opening the
      // tab until OCR finishes / is skipped so the user isn't staring at a blank body.
      flow.setOcrSession({ sourceId: result.sourceId, title: result.title, pageCount: result.pageCount ?? 0 });
      flow.setOcrPdfBytes(await api.sources.readPdf(result.sourceId));
      return;
    }
    openSourceAfterIndex(result.sourceId);
  }

  async function handleIngestUrlAsSource() {
    if (!notebase.meta) return;
    const raw = await showPrompt('URL to ingest as a source:');
    if (!raw) return;
    const url = raw.trim();
    if (!url) return;
    try {
      const result = await busy.withBusy('Fetching…', () => api.sources.ingestUrl(url));
      await handleIngestedSourceResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Ingest failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleExternalDrop(destFolder: string, files: FileList) {
    if (!notebase.meta) return;
    const localPaths: string[] = [];
    for (const f of files) {
      // Electron 32+: `webUtils.getPathForFile` is the supported accessor;
      // `File.path` was deprecated and is removed in Electron 34.
      const p = api.files.getPathForFile(f);
      if (p) localPaths.push(p);
    }
    if (localPaths.length === 0) return;
    try {
      const result = await busy.withBusy('Importing…', () =>
        api.files.dropImport(destFolder, localPaths),
      );
      // Open the first newly-ingested PDF source tab, matching the menu-
      // triggered Ingest PDF flow.
      const openablePdf = result.ingestedPdfs.find((p) => !p.duplicate) ?? result.ingestedPdfs[0];
      if (openablePdf) {
        openSourceAfterIndex(openablePdf.sourceId);
      }
      if (result.rejected.length > 0) {
        const lines = result.rejected
          .map((r) => `• ${r.localPath.split('/').pop()} — ${r.reason}`)
          .join('\n');
        await showConfirm(
          `Some files were skipped:\n${lines}`,
          CONFIRM_KEYS.dropImportRejected,
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Import failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleImportBibtex() {
    if (!notebase.meta) return;
    try {
      const result = await busy.withBusy('Importing BibTeX…', () => api.sources.importBibtex());
      if (!result) return; // user cancelled the picker
      // Refresh the Sources panel so the new entries are immediately visible.
      ctx.getSidebar()?.refreshSources();
      await ctx.refreshSourcesCache();
      const parts: string[] = [
        `Imported: ${result.imported.length}`,
        `Duplicate (skipped): ${result.duplicate.length}`,
      ];
      if (result.failed.length > 0) parts.push(`Failed: ${result.failed.length}`);
      if (result.parseErrors > 0) parts.push(`Parse errors: ${result.parseErrors}`);
      let message = `BibTeX import complete.\n\n${parts.join('\n')}`;
      if (result.failed.length > 0) {
        const preview = result.failed
          .slice(0, 5)
          .map((f) => `  • ${f.key}: ${f.reason}`)
          .join('\n');
        const more = result.failed.length > 5 ? `\n  …and ${result.failed.length - 5} more` : '';
        message += `\n\nFirst failures:\n${preview}${more}`;
      }
      await showConfirm(message, CONFIRM_KEYS.bibtexImportComplete, 'OK');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`BibTeX import failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleImportZoteroRdf() {
    if (!notebase.meta) return;
    try {
      const result = await busy.withBusy('Importing Zotero RDF…', () => api.sources.importZoteroRdf());
      if (!result) return;
      ctx.getSidebar()?.refreshSources();
      await ctx.refreshSourcesCache();
      const pdfsLifted = result.imported.filter((i) => i.pdfAttached).length;
      const parts: string[] = [
        `Imported: ${result.imported.length}` + (pdfsLifted > 0 ? ` (${pdfsLifted} with PDF)` : ''),
        `Duplicate (skipped): ${result.duplicate.length}`,
      ];
      if (result.failed.length > 0) parts.push(`Failed: ${result.failed.length}`);
      let message = `Zotero RDF import complete.\n\n${parts.join('\n')}`;
      if (result.failed.length > 0) {
        const preview = result.failed
          .slice(0, 5)
          .map((f) => `  • ${f.subject}: ${f.reason}`)
          .join('\n');
        const more = result.failed.length > 5 ? `\n  …and ${result.failed.length - 5} more` : '';
        message += `\n\nFirst failures:\n${preview}${more}`;
      }
      await showConfirm(message, CONFIRM_KEYS.zoteroRdfImportComplete, 'OK');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Zotero RDF import failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleIngestFileAsSource() {
    if (!notebase.meta) return;
    try {
      const result = await busy.withBusy('Ingesting…', () => api.sources.ingestFile());
      if (!result) return; // user cancelled the picker
      await handleIngestedSourceResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Ingest failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleOcrDone(pages: string[]) {
    if (!flow.ocrSession) return;
    const { sourceId } = flow.ocrSession;
    flow.setOcrSession(null);
    flow.setOcrPdfBytes(null);
    try {
      await api.sources.finishPdfOcr(sourceId, pages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`OCR save failed: ${msg}`, CONFIRM_KEYS.ingestPdfFailed, 'OK');
      return;
    }
    openSourceAfterIndex(sourceId);
  }

  function handleOcrCancel() {
    // Source + original.pdf stay on disk; body.md is the "OCR pending"
    // placeholder. User can delete the source if they want it gone.
    if (!flow.ocrSession) return;
    const { sourceId } = flow.ocrSession;
    flow.setOcrSession(null);
    flow.setOcrPdfBytes(null);
    openSourceAfterIndex(sourceId);
  }

  /**
   * Right-click a source → "Mine references…" (#106). Runs the LLM
   * mining call, opens a review dialog. User checks the candidates
   * they want, clicks Approve → backend writes the stub files and
   * adds `minerva:references` edges from the parent.
   */
  async function handleMineReferences(source: SourceMetadata): Promise<void> {
    try {
      const refs = await busy.withBusy('Mining references…', () =>
        api.sources.mineReferences(source.sourceId),
      );
      if (refs.length === 0) {
        await showConfirm(
          'No references the LLM could parse. The body.md may not have a References section, or its formatting is too irregular for first-pass extraction.',
          CONFIRM_KEYS.mineReferencesEmpty,
          'OK',
        );
        return;
      }
      flow.setMineReview({
        parentId: source.sourceId,
        parentTitle: source.title ?? source.sourceId,
        refs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Couldn't mine references: ${msg}`, CONFIRM_KEYS.mineReferencesFailed, 'OK');
    }
  }

  async function handleMineReferencesApply(
    accepted: ParsedReference[],
  ): Promise<void> {
    const state = flow.mineReview;
    flow.setMineReview(null);
    if (!state) return;
    try {
      const result = await busy.withBusy('Creating stubs…', () =>
        api.sources.createReferenceStubs(state.parentId, accepted),
      );
      await ctx.refreshSourcesCache();
      const lines: string[] = [];
      if (result.created.length > 0) lines.push(`Created ${result.created.length} new stub${result.created.length === 1 ? '' : 's'}.`);
      if (result.matchedExisting.length > 0) lines.push(`${result.matchedExisting.length} matched existing sources.`);
      if (result.skipped.length > 0) lines.push(`${result.skipped.length} skipped (id collision).`);
      if (lines.length > 0) {
        await showConfirm(lines.join(' '), CONFIRM_KEYS.mineReferencesResult, 'OK');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Couldn't create stubs: ${msg}`, CONFIRM_KEYS.mineReferencesFailed, 'OK');
    }
  }

  async function handleResolveStub(sourceId: string): Promise<void> {
    if (!notebase.meta) return;
    let candidates: ResolveCandidate[];
    try {
      candidates = await busy.withBusy('Searching CrossRef…', () =>
        api.sources.resolveStub(sourceId),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Resolve failed: ${msg}`, CONFIRM_KEYS.resolveStubFailed, 'OK');
      return;
    }
    if (candidates.length === 0) {
      await showConfirm(
        'CrossRef returned no matches. Refine the stub’s title or authors, or ingest the DOI directly.',
        CONFIRM_KEYS.resolveStubEmpty,
        'OK',
      );
      return;
    }
    const top = candidates[0]!;
    if (top.confidence >= RESOLVE_AUTO_THRESHOLD) {
      await applyResolution(sourceId, top.doi, top.title);
      return;
    }
    // Below threshold — let the user pick.
    const detail = await api.graph.sourceDetail(sourceId);
    flow.setResolveStub({
      sourceId,
      stubTitle: detail ? displaySourceTitle(detail.metadata) : sourceId,
      candidates,
    });
  }

  async function handleResolveStubApply(doi: string): Promise<void> {
    const state = flow.resolveStub;
    flow.setResolveStub(null);
    if (!state) return;
    const picked = state.candidates.find((c) => c.doi === doi);
    await applyResolution(state.sourceId, doi, picked?.title ?? state.stubTitle);
  }

  async function applyResolution(sourceId: string, doi: string, newTitle: string): Promise<void> {
    try {
      await busy.withBusy('Applying resolution…', () =>
        api.sources.applyStubResolution(sourceId, doi),
      );
      await ctx.refreshSourcesCache();
      await showConfirm(
        `Resolved to "${newTitle}". The source's metadata now reflects the CrossRef record; the source id stays the same so existing citations keep resolving.`,
        CONFIRM_KEYS.resolveStubApplied,
        'OK',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Couldn’t apply resolution: ${msg}`, CONFIRM_KEYS.resolveStubFailed, 'OK');
    }
  }

  /**
   * Click on a bare-DOI link inside the markdown preview (#473).
   * If the DOI already maps to an ingested source, open it. Otherwise
   * offer to ingest — dismissable, keyed so the user can suppress
   * the prompt project-wide once they've made up their mind.
   */
  async function handleDoiClick(doi: string): Promise<void> {
    if (!notebase.meta) return;
    // Normalise — sources store DOIs case-folded; user input might
    // have mixed case from the rendered link text.
    const target = doi.toLowerCase();
    const existing = ctx.findSourceByDoi(target);
    if (existing) {
      ctx.openSource(existing.sourceId);
      return;
    }
    const confirmed = await showConfirm(
      `Ingest this DOI as a new source?\n\n${doi}`,
      CONFIRM_KEYS.ingestDoiFromBody,
      'Ingest',
    );
    if (!confirmed) return;
    try {
      const result = await busy.withBusy('Looking up…', () => api.sources.ingestIdentifier(doi));
      openSourceAfterIndex(result.sourceId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Ingest failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleIngestIdentifier() {
    if (!notebase.meta) return;
    const raw = await showPrompt('DOI, arXiv id, or PubMed id:');
    if (!raw) return;
    const identifier = raw.trim();
    if (!identifier) return;
    try {
      const result = await busy.withBusy('Looking up…', () => api.sources.ingestIdentifier(identifier));
      openSourceAfterIndex(result.sourceId);
      if (result.duplicate) {
        await showConfirm(
          `Already ingested: "${result.title || result.sourceId}". Opened the existing source.`,
          CONFIRM_KEYS.ingestDuplicate,
          'OK',
        );
      } else if (result.pdfError) {
        await showConfirm(
          `Ingested "${result.title}", but the open-access PDF fetch failed: ${result.pdfError}. The source's bibo:uri points at the canonical record so you can still grab it by hand.`,
          CONFIRM_KEYS.ingestPdfFailed,
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Ingest failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  return {
    handleIngestedSourceResult, handleIngestUrlAsSource, handleIngestFileAsSource,
    handleIngestIdentifier, handleOcrDone, handleOcrCancel, handleMineReferences,
    handleMineReferencesApply, handleResolveStub, handleResolveStubApply, handleDoiClick,
    handleImportBibtex, handleImportZoteroRdf, handleExternalDrop,
  };
}
