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

import { app } from 'electron';
import * as graph from './graph/index';
import * as search from './search/index';
import { listProposals } from './llm/approval';
import * as tables from './sources/tables';
import * as vectors from './embeddings/vector-store';
import { getSharedEmbedder } from './embeddings/shared-embedder';
import { abortBackfill } from './embeddings/backfill';
import * as healthChecks from './graph/health-checks';
import * as conversation from './llm/conversation';
import { projectContext, type ProjectContext } from './project-context-types';
import { disposeAllProjectStores } from './project-store';
import { registerProject, unregisterProject } from './substrate/app-server';
import { getInspectionSettings } from './config/inspection-settings';

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
      // Captioned markdown tables register after CSVs so a name shared by both
      // resolves deterministically — CSV wins, note table is skipped (#1358).
      await tables.registerAllNoteTables(ctx);
      // Re-project conversation JSON into the graph after notes are
      // indexed (so contextNote IRIs resolve against a populated note
      // namespace). Also self-heals stale relative-path triples from
      // before #350.
      await conversation.reindexAllConversations(rootPath);
      // Health checks run once at open, then a periodic timer takes over.
      // Fire-and-forget — no need to block project init on the result. Both
      // paths read the user's inspection settings (#1792 follow-up): without
      // that, disabling a check appeared to work until the next automatic run
      // silently reinstated it.
      void (async () => {
        const inspectionSettings = await getInspectionSettings();
        await healthChecks.runAllChecks(ctx, inspectionSettings);
      })();
      // Re-check a couple of seconds after any graph write (#1795) — saving a
      // note is when you want to hear that you just broke a link.
      healthChecks.armAutoChecks(ctx, { loadSettings: getInspectionSettings });
      // The timer stays, but only as a backstop for the checks that fire with
      // the CLOCK rather than with an edit: a note going stale, a stub ageing
      // past its threshold. Nothing writes to the graph when that happens, so
      // there's no change for the line above to react to.
      healthChecks.startPeriodicChecks(ctx, { loadSettings: getInspectionSettings });
      // Advertise this project to out-of-process CLI/MCP clients (#1524) so they
      // route proposals + semantic search through us instead of racing our
      // files. Best-effort; awaited so the advert exists the moment open resolves.
      await registerProject(ctx);
      // Reflect any proposals filed while this project was closed in the dock
      // badge the moment it opens (#1528).
      void updateDockBadge();
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
  healthChecks.disarmAutoChecks(rec.ctx);
  // Stop advertising to out-of-process clients before we tear the ctx down, so
  // no routed request can land on a half-disposed project (#1524).
  await unregisterProject(rootPath);
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
  // Drop this project's pending proposals from the dock badge (#1528).
  void updateDockBadge();
}

/** Resolve the live ProjectContext for a rootPath, if currently held. */
export function getProjectContext(rootPath: string): ProjectContext | null {
  return projects.get(rootPath)?.ctx ?? null;
}

/**
 * Refresh the OS dock/taskbar badge with the total pending-proposal count
 * across every open project (#1528) — so "you have N proposals" is visible even
 * when Minerva is unfocused, and stays live as proposals are filed (in-app or
 * out-of-process), approved, rejected, expired, or as projects open/close.
 * Best-effort: `app.setBadgeCount` is a no-op on platforms without a badge
 * (Windows), and a failure must never disrupt the change that triggered it.
 */
export async function updateDockBadge(): Promise<void> {
  try {
    let total = 0;
    for (const rec of projects.values()) {
      total += (await listProposals(rec.ctx, 'pending')).length;
    }
    app.setBadgeCount(total);
  } catch (err) {
    console.warn('[project-context] dock badge update failed:', err);
  }
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
