/**
 * Single fan-out for "a note's content changed" / "a note was removed"
 * (#1892). Electron-free so it stays usable from both the watcher
 * (`window-manager.ts`) and the IPC layer (`ipc/helpers.ts`) without a
 * circular import between them.
 *
 * Policy: graph indexing covers every note extension (.md/.ttl/.csv/.py) —
 * `graph.indexNote` dispatches internally. Full-text search and semantic
 * embeddings are markdown-only, matching `search.indexAllNotes`' bulk
 * walker — MiniSearch and the embedder are for prose, not raw Turtle/CSV/
 * Python source.
 *
 * Three hand-copied versions of this fan-out existed before and had
 * drifted: the watcher's `onFileChanged`/`onFileCreated` ran full-text
 * search on every note extension (not just `.md`, unlike the bulk indexer
 * and the IPC-layer copy) and never called into the vector store at all —
 * so a watcher-driven note edit left stale embeddings, and nothing else
 * ever re-checks a note that's already been embedded once
 * (`embeddings/backfill.ts` skips notes with existing rows).
 */
import * as graph from '../graph/index';
import * as search from '../search/index';
import * as vectors from '../embeddings/vector-store';
import type { ProjectContext } from '../project-context-types';

/** Index (or re-index) a note's content into every backend that should have it. */
export async function indexAllFor(ctx: ProjectContext, relativePath: string, content: string): Promise<void> {
  await graph.indexNote(ctx, relativePath, content);
  indexSearchAndVectorsFor(ctx, relativePath, content);
}

/**
 * Mirror of {@link indexAllFor} for removal. Unconditional across all three
 * backends — removing a key that was never indexed there is a no-op, so
 * there's no need to gate by extension the way the index direction does.
 */
export function removeAllFor(ctx: ProjectContext, relativePath: string): void {
  graph.removeNote(ctx, relativePath);
  removeSearchAndVectorsFor(ctx, relativePath);
}

/**
 * The search+vectors half of {@link indexAllFor}, for callers that already
 * indexed the note into the graph themselves (#1985). The rename/merge
 * helpers (`rename.ts`, `merge.ts`, `rename-source-excerpt.ts`,
 * `rename-anchor.ts`) call `graph.indexNote` directly on each rewritten note
 * — they're re-parsing a note whose *links* changed, not any content
 * `indexAllFor`'s caller already has fresh — and pass this as their
 * `reindexHook` for the rest of the fan-out.
 */
export function indexSearchAndVectorsFor(ctx: ProjectContext, relativePath: string, content: string): void {
  if (!relativePath.endsWith('.md')) return;
  search.indexNote(ctx, relativePath, content);
  void vectors.indexNote(ctx, relativePath, content); // #835; no-op when disabled
}

/** The search+vectors half of {@link removeAllFor}, mirroring {@link indexSearchAndVectorsFor}. */
export function removeSearchAndVectorsFor(ctx: ProjectContext, relativePath: string): void {
  search.removeNote(ctx, relativePath);
  void vectors.removeNote(ctx, relativePath); // #835; no-op when disabled
}
