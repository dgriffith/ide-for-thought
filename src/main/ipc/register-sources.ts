import { dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import { broadcast } from './broadcast';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { privilegedFetch } from '../privileged-sites';
import { ingestUrl } from '../sources/ingest';
import { ingestIdentifier } from '../sources/ingest-identifier';
import { finishPdfOcrIngest, readOriginalPdf } from '../sources/ingest-pdf';
import { ingestFile } from '../sources/ingest-file';
import { deleteSource } from '../sources/delete-source';
import { mergeSources, MergeSourcesError } from '../sources/merge-sources';
import { setSourceReadStatus, setSourceReadDueBy } from '../sources/read-status';
import { setSourceTitle, addSourceTag, removeSourceTag } from '../sources/source-meta-write';
import { stripUpstreamTags } from '../sources/strip-upstream-tags';
import { getIngestSettings, saveIngestSettings, type IngestSettings } from '../sources/ingest-settings';
import { ingestSmart } from '../sources/ingest-smart';
import { mineSourceReferences, type ParsedReference } from '../sources/mine-references';
import { createReferenceStubs } from '../sources/create-reference-stubs';
import { resolveStub, applyStubResolution } from '../sources/resolve-stub';
import type { ReadStatus, SourceMetadata, CollectionsFile } from '../../shared/types';
import type { ReadingQueueView } from '../graph/index';
import {
  loadCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  addSourceToCollection,
  removeSourceFromCollection,
  createSmartCollection,
  renameSmartCollection,
  deleteSmartCollection,
  updateSmartCollectionPredicate,
  resolveSmartMembers,
} from '../sources/collections';
import type { SmartCollectionPredicate } from '../../shared/types';
import { importBibtex } from '../sources/import-bibtex';
import { importZoteroRdf } from '../sources/import-zotero-rdf';
import { getExcerptNoteFolder, setExcerptNoteFolder } from '../project-config';
import { createExcerpt } from '../sources/create-excerpt';
import {
  withRootPath, withRootPathOr, withRootPathWin, reindexFile, persistIndexes,
  broadcastSourcesChanged, broadcastExcerptsChanged, broadcastCollectionsChanged,
} from './helpers';
import { handle } from './typed-ipc';

/**
 * Wraps a source-mutating handler (#1916): runs `fn`, reindexes, then
 * broadcasts SOURCES_CHANGED to every window on the project — not just the
 * one that made the change (see {@link broadcastSourcesChanged}). Collapses
 * what used to be six handlers of identical
 * mutate → persistIndexes → broadcast shape.
 */
function withSourceMutation<A extends unknown[], R>(
  fn: (rootPath: string, ...args: A) => Promise<R>,
): (e: Electron.IpcMainInvokeEvent, ...args: A) => Promise<R> {
  return withRootPath(async (rootPath, ...args: A) => {
    const result = await fn(rootPath, ...args);
    await persistIndexes(rootPath);
    broadcastSourcesChanged(rootPath);
    return result;
  });
}

export function registerSources(): void {
  handle(Channels.SOURCES_INGEST_URL, withRootPath(async (rootPath, url: string) => {
    const ingestSettings = await getIngestSettings();
    return await ingestUrl(rootPath, url, {
      fetchImpl: privilegedFetch,
      importUpstreamTags: ingestSettings.importUpstreamTags,
    });
  }));

  handle(Channels.SOURCES_INGEST_IDENTIFIER, withRootPath(async (rootPath, identifier: string) => {
    const ingestSettings = await getIngestSettings();
    return await ingestIdentifier(rootPath, identifier, {
      fetchImpl: privilegedFetch,
      importUpstreamTags: ingestSettings.importUpstreamTags,
    });
  }));

  handle(Channels.SOURCES_INGEST_SMART, withRootPath(async (rootPath, rawInput: string) => {
    const ingestSettings = await getIngestSettings();
    return await ingestSmart(rootPath, rawInput, {
      fetchImpl: privilegedFetch,
      importUpstreamTags: ingestSettings.importUpstreamTags,
    });
  }));

  handle(Channels.SOURCES_MINE_REFERENCES, withRootPath(async (rootPath, sourceId: string) => {
    return await mineSourceReferences(rootPath, sourceId);
  }));

  handle(Channels.SOURCES_CREATE_REFERENCE_STUBS, withSourceMutation((rootPath, params: { sourceId: string; refs: ParsedReference[] }) =>
    createReferenceStubs(rootPath, params.sourceId, params.refs)));

  handle(Channels.SOURCES_RESOLVE_STUB, withRootPath(async (rootPath, sourceId: string) => {
    return await resolveStub(rootPath, sourceId, { fetchImpl: privilegedFetch });
  }));

  handle(Channels.SOURCES_APPLY_STUB_RESOLUTION, withSourceMutation(async (rootPath, params: { sourceId: string; doi: string }) => {
    const ok = await applyStubResolution(rootPath, params.sourceId, params.doi, { fetchImpl: privilegedFetch });
    return { ok };
  }));

  handle(Channels.INGEST_GET_SETTINGS, () => getIngestSettings());
  handle(Channels.INGEST_SET_SETTINGS, (_e, settings: IngestSettings) =>
    saveIngestSettings(settings),
  );

  handle(Channels.SOURCES_IMPORT_BIBTEX, withRootPathWin(async (rootPath, win) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'BibTeX', extensions: ['bib', 'bibtex'] }],
      title: 'Import BibTeX',
      buttonLabel: 'Import',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return await importBibtex(rootPath, result.filePaths[0]!, {
      onProgress: (progress) => {
        if (!win.isDestroyed()) {
          broadcast(win, Channels.SOURCES_IMPORT_BIBTEX_PROGRESS, progress);
        }
      },
    });
  }));

  handle(Channels.SOURCES_IMPORT_ZOTERO_RDF, withRootPathWin(async (rootPath, win) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Zotero RDF', extensions: ['rdf', 'xml'] }],
      title: 'Import Zotero RDF',
      buttonLabel: 'Import',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return await importZoteroRdf(rootPath, result.filePaths[0]!, {
      onProgress: (progress) => {
        if (!win.isDestroyed()) {
          broadcast(win, Channels.SOURCES_IMPORT_ZOTERO_RDF_PROGRESS, progress);
        }
      },
    });
  }));

  handle(Channels.SOURCES_INGEST_FILE, withRootPathWin(async (rootPath, win) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'html', 'htm', 'md', 'markdown', 'txt', 'text'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      title: 'Ingest File as Source',
      buttonLabel: 'Ingest',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const ingested = await ingestFile(rootPath, result.filePaths[0]!);
    // Re-index the new source so it shows up in the sidebar + graph.
    await reindexFile(rootPath, `.minerva/sources/${ingested.sourceId}/meta.ttl`);
    await persistIndexes(rootPath);
    return ingested;
  }));

  // Read the raw PDF bytes of a previously-persisted source, for the
  // renderer-side OCR worker (#95).
  handle(Channels.SOURCES_READ_PDF, withRootPath(async (rootPath, sourceId: string) => {
    return await readOriginalPdf(rootPath, sourceId);
  }));

  // `false` means exactly one thing: this source was ingested without keeping
  // its original PDF (#1881). It used to mean that OR "no project open" OR "the
  // file is there but unreadable", so a PDF the user can see on disk showed no
  // "Open original" button and gave no clue why. There is no meaningful
  // project-less answer to "does this source have a PDF" — nothing can be
  // asking about a source outside an open thoughtbase — so this is
  // `withRootPath`, and only ENOENT is caught.
  handle(Channels.SOURCES_HAS_PDF, withRootPath(async (rootPath, sourceId: string) => {
    try {
      await fs.stat(path.join(rootPath, '.minerva', 'sources', sourceId, 'original.pdf'));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }));

  // Excerpt → Note flow defaults (#101).
  handle(Channels.EXCERPT_GET_NOTE_FOLDER, withRootPathOr('', (rootPath) =>
    getExcerptNoteFolder(rootPath)));
  handle(Channels.EXCERPT_SET_NOTE_FOLDER, withRootPath((rootPath, folder: string) => {
    setExcerptNoteFolder(rootPath, folder);
  }));

  // Finalise a scanned-PDF ingest: the renderer has run OCR and hands
  // back the per-page text. We rewrite body.md + stamp meta.ttl with
  // extractionMethod "ocr" (#95).
  handle(Channels.SOURCES_FINISH_PDF_OCR, withSourceMutation(async (rootPath, sourceId: string, pages: string[]) => {
    await finishPdfOcrIngest(rootPath, sourceId, pages);
    await reindexFile(rootPath, `.minerva/sources/${sourceId}/meta.ttl`);
  }));

  handle(Channels.SOURCES_LIST_ALL, withRootPathOr([], (rootPath) =>
    graph.listAllSources(projectContext(rootPath))));

  handle(Channels.SOURCES_DELETE, withRootPath(async (rootPath, sourceId: string) => {
    const result = await deleteSource(rootPath, sourceId);
    await persistIndexes(rootPath);
    broadcastSourcesChanged(rootPath);
    broadcastExcerptsChanged(rootPath);
    return result;
  }));

  handle(Channels.SOURCES_MERGE, withRootPath(async (rootPath, params: { srcId: string; destId: string }) => {
    try {
      const result = await mergeSources(rootPath, params.srcId, params.destId);
      await persistIndexes(rootPath);
      broadcastSourcesChanged(rootPath);
      broadcastExcerptsChanged(rootPath);
      return result;
    } catch (err) {
      if (err instanceof MergeSourcesError) {
        // Carry the structured code through to the renderer so the UI
        // can distinguish a same-source / not-found error from a real crash.
        const wrapped = new Error(err.message);
        (wrapped as Error & { code?: string }).code = err.code;
        throw wrapped;
      }
      throw err;
    }
  }));

  // ── Reading queue (#116) ──────────────────────────────────────────────────
  handle(Channels.SOURCES_SET_READ_STATUS, withSourceMutation((rootPath, params: { sourceId: string; status: ReadStatus | null }) =>
    setSourceReadStatus(rootPath, params.sourceId, params.status)));

  handle(Channels.SOURCES_SET_TITLE, withSourceMutation((rootPath, params: { sourceId: string; title: string }) =>
    setSourceTitle(rootPath, params.sourceId, params.title)));

  handle(Channels.SOURCES_ADD_TAG, withSourceMutation(async (rootPath, params: { sourceId: string; tag: string }) => {
    await addSourceTag(rootPath, params.sourceId, params.tag);
  }));

  handle(Channels.SOURCES_REMOVE_TAG, withSourceMutation(async (rootPath, params: { sourceId: string; tag: string }) => {
    await removeSourceTag(rootPath, params.sourceId, params.tag);
  }));

  handle(Channels.SOURCES_SET_READ_DUE_BY, withSourceMutation((rootPath, params: { sourceId: string; dueBy: string | null }) =>
    setSourceReadDueBy(rootPath, params.sourceId, params.dueBy)));

  handle(Channels.SOURCES_STRIP_UPSTREAM_TAGS, withSourceMutation((rootPath, sourceId: string) =>
    stripUpstreamTags(rootPath, sourceId)));

  handle(Channels.SOURCES_QUEUE_MEMBERS, withRootPathOr([], (rootPath, view: ReadingQueueView) => {
    const ctx = projectContext(rootPath);
    const ids = new Set(graph.getReadingQueueSourceIds(ctx, view));
    if (ids.size === 0) return [];
    return graph.listAllSources(ctx).filter((s) => ids.has(s.sourceId));
  }));

  // ── Collections (#470) ────────────────────────────────────────────────────
  handle(Channels.COLLECTIONS_LIST, withRootPathOr<[], { collections: never[] } | Promise<CollectionsFile>>({ collections: [] }, async (rootPath) => {
    return await loadCollections(rootPath);
  }));

  handle(Channels.COLLECTIONS_CREATE, withRootPath(async (rootPath, args: { name: string; parent?: string | null }) => {
    const result = await createCollection(rootPath, args);
    broadcastCollectionsChanged(rootPath);
    return result;
  }));

  handle(Channels.COLLECTIONS_RENAME, withRootPath(async (rootPath, args: { id: string; name: string }) => {
    await renameCollection(rootPath, args.id, args.name);
    broadcastCollectionsChanged(rootPath);
  }));

  handle(Channels.COLLECTIONS_DELETE, withRootPath(async (rootPath, id: string) => {
    await deleteCollection(rootPath, id);
    broadcastCollectionsChanged(rootPath);
  }));

  handle(Channels.COLLECTIONS_ADD_SOURCE, withRootPath(async (rootPath, args: { collectionId: string; sourceId: string }) => {
    await addSourceToCollection(rootPath, args.collectionId, args.sourceId);
    broadcastCollectionsChanged(rootPath);
  }));

  handle(Channels.COLLECTIONS_REMOVE_SOURCE, withRootPath(async (rootPath, args: { collectionId: string; sourceId: string }) => {
    await removeSourceFromCollection(rootPath, args.collectionId, args.sourceId);
    broadcastCollectionsChanged(rootPath);
  }));

  handle(Channels.COLLECTIONS_CREATE_SMART, withRootPath(async (rootPath, args: { name: string; predicate: SmartCollectionPredicate }) => {
    const result = await createSmartCollection(rootPath, args);
    broadcastCollectionsChanged(rootPath);
    return result;
  }));

  handle(Channels.COLLECTIONS_RENAME_SMART, withRootPath(async (rootPath, args: { id: string; name: string }) => {
    await renameSmartCollection(rootPath, args.id, args.name);
    broadcastCollectionsChanged(rootPath);
  }));

  handle(Channels.COLLECTIONS_DELETE_SMART, withRootPath(async (rootPath, id: string) => {
    await deleteSmartCollection(rootPath, id);
    broadcastCollectionsChanged(rootPath);
  }));

  handle(Channels.COLLECTIONS_UPDATE_SMART_PREDICATE, withRootPath(async (rootPath, args: { id: string; predicate: SmartCollectionPredicate }) => {
    await updateSmartCollectionPredicate(rootPath, args.id, args.predicate);
    broadcastCollectionsChanged(rootPath);
  }));

  handle(Channels.COLLECTIONS_SMART_MEMBERS, withRootPathOr<[string], SourceMetadata[] | Promise<SourceMetadata[]>>([], async (rootPath, id: string) => {
    const data = await loadCollections(rootPath);
    const smart = data.smartCollections.find((s) => s.id === id);
    if (!smart) return [];
    const ctx = projectContext(rootPath);
    // Resolve via the graph's existing source-by-tag helper. The graph
    // is the source of truth for hasTag edges (notes + sources) so we
    // get the same membership semantics the tag panel surfaces.
    const matchingIds = resolveSmartMembers(smart.predicate, {
      sourcesByTag: (tag) => graph.sourcesByTag(ctx, tag),
      sourcesByReadStatus: (status) => graph.sourcesByReadStatus(ctx, status),
    });
    if (matchingIds.size === 0) return [];
    const all = graph.listAllSources(ctx);
    return all.filter((s) => matchingIds.has(s.sourceId));
  }));

  handle(Channels.SOURCES_CREATE_EXCERPT, withRootPath(async (rootPath, params: {
    sourceId: string;
    citedText: string;
    page?: number | null;
    pageRange?: string | null;
    locationText?: string | null;
  }) => {
    return await createExcerpt(rootPath, params);
  }));
}
