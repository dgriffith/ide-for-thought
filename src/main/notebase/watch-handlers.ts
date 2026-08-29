/**
 * File-watcher callback bundle for one open project (#1907 — extracted out
 * of the ~270-line `openProjectInWindow` in `../window-manager.ts`, one of
 * only two genuine long-procedure cases in the codebase).
 *
 * `createWatchHandlers()` owns its own debounce state (the persist timer, the
 * per-.py-file kernel-invalidate queue) — nothing outside a single project's
 * watch lifecycle needs either, so a fresh instance per call is exactly the
 * right lifetime. Takes a `broadcastIfAlive` callback instead of a
 * `BrowserWindow` so the handlers are testable without constructing one —
 * the thing the stale-vector bug (#1892) needed and didn't have.
 */
import { Channels } from '../../shared/channels';
import type { EventMap } from '../../shared/ipc-contract';
import * as graph from '../graph/index';
import * as search from '../search/index';
import * as notebaseFs from './fs';
import * as tables from '../sources/tables';
import { indexAllFor, removeAllFor } from './index-fanout';
import { invalidate as invalidatePythonModules } from '../compute/python-kernel';
import * as vectors from '../embeddings/vector-store';
import { citedTextFromTtl } from '../sources/create-excerpt';
import { wasHandled } from './path-dedup';
import type { ProjectContext } from '../project-context-types';
import type { WatcherCallbacks } from './watcher';

/** Channels these handlers broadcast — all fire-and-forget "something
 *  changed" pings with no payload. */
type NoPayloadEvent = { [K in keyof EventMap]: Parameters<EventMap[K]> extends [] ? K : never }[keyof EventMap];

export interface WatchHandlerDeps {
  rootPath: string;
  projectCtx: ProjectContext;
  /** Broadcasts a payload-less channel to the window if it's still alive —
   *  abstracts away `win.isDestroyed()` / `broadcast(win, …)` so these
   *  handlers don't need a real `BrowserWindow` to be exercised in a test. */
  broadcastIfAlive: (channel: NoPayloadEvent) => void;
}

/**
 * Builds the `WatcherCallbacks` bundle `startWatching` invokes for one open
 * project.
 */
export function createWatchHandlers(deps: WatchHandlerDeps): WatcherCallbacks {
  const { rootPath, projectCtx, broadcastIfAlive } = deps;

  // Deduplication: IPC handlers mark paths they've already indexed
  // (see `notebase/path-dedup.ts`).
  let indexPersistTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedPersist = () => {
    if (indexPersistTimer) clearTimeout(indexPersistTimer);
    indexPersistTimer = setTimeout(async () => {
      // graph.ttl is a cold snapshot now (#348) — fully reconstructible
      // from notes/sources/excerpts/CSVs/conversations/proposals, so we
      // skip per-write serialization. Search index isn't reconstructed
      // automatically, so it still gets the live persist.
      await search.persist(projectCtx);
    }, 1000);
  };

  // Coalesce `.py` edits into a single kernel-invalidate call (#529).
  // A flurry of editor saves (autosave, formatter pass, find-replace) on
  // the same module shouldn't fan out into a separate invalidate per
  // write — the kernel just needs to know "these modules are stale" once
  // the writes settle. 300ms matches the responsiveness window for
  // re-running an importing cell while still grouping a multi-file
  // formatter pass.
  let pyInvalidatePaths = new Set<string>();
  let pyInvalidateTimer: ReturnType<typeof setTimeout> | null = null;
  const queuePyInvalidate = (relativePath: string) => {
    pyInvalidatePaths.add(relativePath);
    if (pyInvalidateTimer) clearTimeout(pyInvalidateTimer);
    pyInvalidateTimer = setTimeout(() => {
      const paths = [...pyInvalidatePaths];
      pyInvalidatePaths = new Set();
      pyInvalidateTimer = null;
      invalidatePythonModules(rootPath, paths);
    }, 300);
  };

  /**
   * Given a watched path that might affect a CSV's registration,
   * return the project-relative path of the CSV to re-register, or
   * null when no sibling table needs updating (#237).
   *
   * Two trigger shapes:
   *   - `<stem>.csv.schema.yaml` → re-register `<stem>.csv`.
   *   - `<stem>.md` (companion note) → re-register `<stem>.csv` if it
   *     exists on disk. The companion may declare `table_name:` or
   *     a `csv:` schema block, either of which changes registration.
   *
   * The .csv itself is handled by the existing branch in the caller —
   * this helper specifically covers the sibling-edit case.
   */
  async function siblingCsvForReregister(relativePath: string): Promise<string | null> {
    if (relativePath.endsWith('.csv.schema.yaml')) {
      return relativePath.slice(0, -'.schema.yaml'.length);
    }
    if (relativePath.toLowerCase().endsWith('.md')) {
      const csvCandidate = relativePath.replace(/\.md$/i, '.csv');
      try {
        await notebaseFs.readFile(rootPath, csvCandidate);
        return csvCandidate;
      } catch { /* no sibling CSV — common case */ }
    }
    return null;
  }

  async function reregisterSibling(relativePath: string): Promise<void> {
    const csvPath = await siblingCsvForReregister(relativePath);
    if (!csvPath) return;
    try {
      await tables.registerCsv(projectCtx, csvPath);
      broadcastIfAlive(Channels.TABLES_CHANGED);
      // Collisions broadcast via the per-project listener attached
      // before acquireProject — no extra wiring here.
    } catch (err) {
      console.warn(`[tables] sibling re-register failed for ${csvPath} (via ${relativePath}):`, err);
    }
  }

  /**
   * Shared tail for `onFileChanged` / `onFileCreated` (#1907): the two used
   * to duplicate this block verbatim — CSV branch, `.py` kernel-invalidate,
   * `.csv.schema.yaml` early return, read→index→reregister-tables→persist —
   * differing only in a comment. A newly-created `.py` file can land while a
   * same-named, just-deleted one is still in `sys.modules` (e.g. a git
   * checkout/restore), so treating create the same as change for the
   * invalidate branch is deliberate, not an oversight.
   */
  async function upsert(relativePath: string): Promise<void> {
    // CSVs route to DuckDB first in an independent try. registerCsv doesn't
    // read the file content into memory (DuckDB reads lazily on query), so
    // it's cheap and hard to fail — keeping it outside the graph+search
    // pipeline means a graph indexing hiccup can't skip table registration.
    if (relativePath.toLowerCase().endsWith('.csv')) {
      try {
        await tables.registerCsv(projectCtx, relativePath);
        broadcastIfAlive(Channels.TABLES_CHANGED);
      } catch (err) { console.warn(`[tables] registerCsv failed for ${relativePath}:`, err); }
    } else {
      await reregisterSibling(relativePath);
    }
    if (relativePath.toLowerCase().endsWith('.py')) {
      queuePyInvalidate(relativePath);
    }
    // Sidecar yaml schemas aren't notes — skip the graph/search pass for
    // them. The watcher fires for them only so the registerCsv branch
    // above can update DuckDB.
    if (relativePath.endsWith('.csv.schema.yaml')) return;
    try {
      const content = await notebaseFs.readFile(rootPath, relativePath);
      await indexAllFor(projectCtx, relativePath, content);
      // Captioned markdown tables in the note re-register in DuckDB (#1358).
      if (relativePath.toLowerCase().endsWith('.md')) {
        const r = await tables.reregisterNoteTables(projectCtx, relativePath, content);
        if (r.changed) broadcastIfAlive(Channels.TABLES_CHANGED);
      }
      debouncedPersist();
    } catch (err) {
      // Usually a race (file deleted between events), but log so real bugs
      // don't hide in silence.
      console.warn(`[watcher] indexing failed for ${relativePath}:`, err);
    }
  }

  return {
    onFileChanged: async (relativePath) => {
      if (wasHandled(relativePath)) return;
      await upsert(relativePath);
    },
    onFileCreated: async (relativePath) => {
      if (wasHandled(relativePath)) return;
      await upsert(relativePath);
    },
    onFileDeleted: async (relativePath) => {
      if (wasHandled(relativePath)) return;
      if (relativePath.toLowerCase().endsWith('.csv')) {
        try {
          await tables.unregisterCsv(projectCtx, relativePath);
          broadcastIfAlive(Channels.TABLES_CHANGED);
        } catch (err) { console.warn(`[tables] unregisterCsv failed for ${relativePath}:`, err); }
      } else {
        // Schema sidecar deleted → CSV reverts to read_csv_auto. Same
        // helper because the sibling lookup logic is identical; the CSV
        // re-registers without the schema.
        await reregisterSibling(relativePath);
      }
      if (relativePath.endsWith('.csv.schema.yaml')) return;
      try {
        removeAllFor(projectCtx, relativePath);
        // Drop any DuckDB tables the deleted note owned (#1358). A rename
        // surfaces as delete+create, so the create half re-registers them.
        if (relativePath.toLowerCase().endsWith('.md')) {
          await tables.unregisterNoteTables(projectCtx, relativePath);
          broadcastIfAlive(Channels.TABLES_CHANGED);
        }
      } catch (err) {
        console.warn(`[watcher] removeNote failed for ${relativePath}:`, err);
      }
      debouncedPersist();
    },
    onSourceMetaChanged: async (sourceId) => {
      try {
        const metaContent = await notebaseFs.readFile(rootPath, `.minerva/sources/${sourceId}/meta.ttl`);
        let bodyContent: string | undefined;
        try {
          bodyContent = await notebaseFs.readFile(rootPath, `.minerva/sources/${sourceId}/body.md`);
        } catch { /* body optional */ }
        graph.indexSource(projectCtx, sourceId, metaContent, bodyContent);
        void vectors.indexSource(projectCtx, sourceId, bodyContent ?? ''); // #839
        debouncedPersist();
        broadcastIfAlive(Channels.SOURCES_CHANGED);
      } catch { /* meta.ttl may have been deleted between events */ }
    },
    onSourceMetaDeleted: (sourceId) => {
      graph.removeSource(projectCtx, sourceId);
      void vectors.removeSource(projectCtx, sourceId); // #839
      debouncedPersist();
      broadcastIfAlive(Channels.SOURCES_CHANGED);
    },
    onExcerptChanged: async (excerptId) => {
      try {
        const relPath = `.minerva/excerpts/${excerptId}.ttl`;
        const content = await notebaseFs.readFile(rootPath, relPath);
        graph.indexExcerpt(projectCtx, excerptId, content);
        void vectors.indexExcerpt(projectCtx, excerptId, citedTextFromTtl(content) ?? ''); // #839
        debouncedPersist();
        broadcastIfAlive(Channels.EXCERPTS_CHANGED);
      } catch { /* file may have been deleted between events */ }
    },
    onExcerptDeleted: (excerptId) => {
      graph.removeExcerpt(projectCtx, excerptId);
      void vectors.removeExcerpt(projectCtx, excerptId); // #839
      debouncedPersist();
      broadcastIfAlive(Channels.EXCERPTS_CHANGED);
    },
  };
}
