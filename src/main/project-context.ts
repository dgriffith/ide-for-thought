/**
 * Runtime registry for ProjectContext (#333).
 *
 * Tracks which BrowserWindows have a given project open, so per-project
 * subsystem state (graph, tables, search, conversation, health-checks)
 * can be initialized once when the first window opens the project and
 * disposed when the last window closes it.
 *
 * Window-manager is the only caller. It acquires on `openProjectInWindow`
 * and releases on close.
 */

import * as graph from './graph/index';
import * as search from './search/index';
import * as tables from './sources/tables';
import * as vectors from './embeddings/vector-store';
import { getSharedEmbedder } from './embeddings/shared-embedder';
import { abortBackfill } from './embeddings/backfill';
import * as healthChecks from './graph/health-checks';
import * as conversation from './llm/conversation';
import { projectContext, type ProjectContext } from './project-context-types';
import { disposeAllProjectStores } from './project-store';

interface ProjectRecord {
  ctx: ProjectContext;
  rootPath: string;
  /** winIds currently holding this project open. */
  acquirers: Set<number>;
  /** First-acquire init: shared between concurrent acquirers so they all
   * await the same initialisation before continuing. */
  initPromise: Promise<void>;
}

const projects = new Map<string, ProjectRecord>();

/** Test/diagnostic visibility — number of windows holding `rootPath` open. */
export function refCountFor(rootPath: string): number {
  return projects.get(rootPath)?.acquirers.size ?? 0;
}

/** Test/diagnostic visibility — every project currently held open. */
export function activeProjects(): string[] {
  return [...projects.keys()];
}

/**
 * Acquire a project for a window. First acquirer triggers full init
 * (graph + tables + search + conversation + health-checks). Subsequent
 * acquirers reuse the in-flight or completed init promise — they wait
 * for it but don't re-run it.
 */
export async function acquireProject(rootPath: string, winId: number): Promise<ProjectContext> {
  let rec = projects.get(rootPath);
  if (!rec) {
    const ctx = projectContext(rootPath);
    const initPromise = (async () => {
      await graph.initGraph(ctx);
      await tables.initTablesDb(ctx);
      // Vector store (#835): open the persisted embeddings DB + schema. Cheap —
      // no model load (the embedder is lazy). Existing notes are embedded
      // incrementally on save, or in bulk by the backfill (#836); opening a
      // project doesn't eagerly embed the corpus. Non-fatal: semantic search is
      // an enhancement, so a store-open failure must never block project open.
      try {
        await vectors.init(ctx, { embedder: getSharedEmbedder() });
      } catch (err) {
        console.warn(`[project-context] vector store init failed for ${rootPath}:`, err);
      }
      conversation.initConversations(rootPath);
      // graph.indexAllNotes resets the rdflib store (`state.store = $rdf.graph()`)
      // then rebuilds it; registerAllCsvs writes the CSV table-schema overlay to
      // that same store via indexCsvTable. Running them concurrently is a latent
      // hazard — if a schema write lands before the reset (an array reorder or an
      // added await would do it) those triples go to the discarded store and
      // vanish silently. So sequence: index notes (owns the reset), THEN register
      // CSVs against the now-stable store. search.indexAllNotes is independent
      // (MiniSearch, never touches the rdflib store), so it stays parallel. As a
      // bonus, registerAllCsvs's `minerva:fromFile` links now resolve against
      // fully-indexed notes. (#337 follow-up.)
      await Promise.all([
        graph.indexAllNotes(ctx),
        search.indexAllNotes(ctx),
      ]);
      await tables.registerAllCsvs(ctx);
      // Re-project conversation JSON into the graph after notes are
      // indexed (so contextNote IRIs resolve against a populated note
      // namespace). Also self-heals stale relative-path triples from
      // before #350.
      await conversation.reindexAllConversations();
      // Health checks run once at open, then a periodic timer takes over.
      // Fire-and-forget — no need to block project init on the result.
      void healthChecks.runAllChecks(ctx);
      healthChecks.startPeriodicChecks(ctx);
    })();
    rec = { ctx, rootPath, acquirers: new Set(), initPromise };
    projects.set(rootPath, rec);
  }
  rec.acquirers.add(winId);
  await rec.initPromise;
  return rec.ctx;
}

/**
 * Release a project from a window. When the last acquirer drops, persist
 * once and dispose every per-project state map.
 */
export async function releaseProject(rootPath: string, winId: number): Promise<void> {
  const rec = projects.get(rootPath);
  if (!rec) return;
  rec.acquirers.delete(winId);
  if (rec.acquirers.size > 0) return;

  // Last window closed for this project — dispose.
  abortBackfill(rootPath); // stop any in-flight embedding backfill (#836)
  healthChecks.stopPeriodicChecks(rec.ctx);
  // Best-effort final persist before tearing down state. A failure here
  // shouldn't block disposal — the on-disk graph is already up to date
  // through the debounced persist that runs while the window is open.
  try {
    await Promise.all([search.persist(rec.ctx), graph.persistGraph(rec.ctx)]);
  } catch (err) {
    console.warn(`[project-context] final persist failed for ${rootPath}:`, err);
  }
  // Tear down every per-project store — graph, search, tables, and the vector
  // store's embeddings DB (#835) — by iterating the registry instead of naming
  // each (#1085). Disposal has no cross-store ordering dependency, unlike init.
  await disposeAllProjectStores(rec.ctx);
  projects.delete(rootPath);
}

/** Resolve the live ProjectContext for a rootPath, if currently held. */
export function getProjectContext(rootPath: string): ProjectContext | null {
  return projects.get(rootPath)?.ctx ?? null;
}

/**
 * Flush every currently-held project's persistent state to disk —
 * called from app-quit so the cold-snapshot graph.ttl (#348) gets the
 * latest before the process exits. Doesn't dispose state; an active
 * project stays acquired until its last window closes.
 */
export async function flushAllProjects(): Promise<void> {
  await Promise.all(
    [...projects.values()].map(async (rec) => {
      try {
        await Promise.all([search.persist(rec.ctx), graph.persistGraph(rec.ctx)]);
      } catch (err) {
        console.warn(`[project-context] flush failed for ${rec.rootPath}:`, err);
      }
    }),
  );
}
