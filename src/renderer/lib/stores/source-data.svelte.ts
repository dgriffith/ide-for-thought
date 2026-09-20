/**
 * Source + collection data mutations and change subscriptions (#1086).
 *
 * The single renderer chokepoint for writing source/collection state and for
 * observing main→renderer source/collection/excerpt change broadcasts.
 * Components (SourcesPanel, SourceDetail, PdfViewer, OcrProgressDialog,
 * conversations/MessageList) call these instead of `api.sources.*` /
 * `api.collections.*` directly, per the renderer data-flow rule (CLAUDE.md).
 * Reads (`listAll`, `queueMembers`, `smartMembers`, `list`, `hasPdf`, …) stay
 * in the components — only mutations and event subscriptions live here.
 *
 * These are thin passthroughs: they own the `api` call so the mutation surface
 * is enforceable + mockable in tests; they don't cache the data (each panel
 * still owns its own view state and refreshes on the change events below).
 */
import type { ReadStatus, SmartCollectionPredicate } from '../../../shared/types';
import { api } from '../ipc/client';

export function getSourceDataStore() {
  return {
    // ── Source mutations ──────────────────────────────────────────────────
    setReadStatus: (sourceId: string, status: ReadStatus | null) =>
      api.sources.setReadStatus(sourceId, status),
    setReadDueBy: (sourceId: string, dueBy: string | null) =>
      api.sources.setReadDueBy(sourceId, dueBy),
    /** Rename a source (#2232). Paired with `addTag`/`deleteSource` below:
     *  all three were called straight from `lib/sources/source-actions.ts`,
     *  which the data-flow rule couldn't see while it was scoped to `.svelte`
     *  files under `components/`. */
    setTitle: (sourceId: string, title: string) => api.sources.setTitle(sourceId, title),
    addTag: (sourceId: string, tag: string) => api.sources.addTag(sourceId, tag),
    removeTag: (sourceId: string, tag: string) => api.sources.removeTag(sourceId, tag),
    /** Delete a source and its excerpts. Named `deleteSource` rather than
     *  `delete` — a bare `delete` reads as the reserved word at call sites. */
    deleteSource: (sourceId: string) => api.sources.delete(sourceId),
    createExcerpt: (params: Parameters<typeof api.sources.createExcerpt>[0]) =>
      api.sources.createExcerpt(params),
    ingestSmart: (rawInput: string) => api.sources.ingestSmart(rawInput),
    ingestUrl: (url: string) => api.sources.ingestUrl(url),
    merge: (srcId: string, destId: string) => api.sources.merge(srcId, destId),
    stripUpstreamTags: (sourceId: string) => api.sources.stripUpstreamTags(sourceId),

    // ── Collection mutations ──────────────────────────────────────────────
    createCollection: (args: { name: string; parent?: string | null }) =>
      api.collections.create(args),
    renameCollection: (id: string, name: string) => api.collections.rename(id, name),
    removeCollection: (id: string) => api.collections.remove(id),
    addSourceToCollection: (collectionId: string, sourceId: string) =>
      api.collections.addSource(collectionId, sourceId),
    removeSourceFromCollection: (collectionId: string, sourceId: string) =>
      api.collections.removeSource(collectionId, sourceId),
    createSmartCollection: (args: { name: string; predicate: SmartCollectionPredicate }) =>
      api.collections.createSmart(args),
    renameSmartCollection: (id: string, name: string) => api.collections.renameSmart(id, name),
    removeSmartCollection: (id: string) => api.collections.removeSmart(id),
    updateSmartPredicate: (id: string, predicate: SmartCollectionPredicate) =>
      api.collections.updateSmartPredicate(id, predicate),

    // ── Change subscriptions (main → renderer) ────────────────────────────
    /** Fires when an excerpt is added / updated / removed. */
    onExcerptsChanged: (cb: () => void) => api.sources.onExcerptsChanged(cb),
    /** Fires when a source is added / updated / removed. */
    onSourcesChanged: (cb: () => void) => api.sources.onChanged(cb),
    /** Fires when a collection (manual or smart) changes. */
    onCollectionsChanged: (cb: () => void) => api.collections.onChanged(cb),
  };
}
