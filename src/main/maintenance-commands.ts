/**
 * The long-running project commands, as functions instead of menu click
 * handlers (#2233, epic #2241).
 *
 * These five — rebuild indexes, rebuild the semantic index, interrupt a cell,
 * restart the kernel, export the knowledge graph — used to be `await`-ing
 * bodies inside `menu.ts`'s click handlers. That made the native menu a second
 * command surface with none of the discipline the IPC layer has: no typed
 * channel, no `ChannelMap` entry, no preload method, no registrar test, and its
 * own `projectContext(rootPath)` built from a raw string. Every existing check
 * is about imports or about IPC, and inline menu execution is neither, so
 * nothing saw it.
 *
 * Now the operations live here, `ipc/register-maintenance.ts` exposes them as
 * typed channels, and `menu.ts` calls the same functions. One implementation,
 * two surfaces — rather than one implementation per surface, which is how
 * "Export Knowledge Graph" ended up meaning two different files (see
 * `exportKnowledgeGraph` below).
 *
 * Electron enters only through the injected `emit` callbacks and the save
 * dialog, so each command is testable without a BrowserWindow.
 */
import * as graph from './graph/index';
import * as search from './search/index';
import * as tables from './sources/tables';
import { projectContext } from './project-context-types';
import { runMaintenance, pluralizeNotes } from './maintenance';
import { runBackfill } from './embeddings/backfill';
import {
  restartKernel as restartPythonKernel,
  interruptKernel as interruptPythonKernel,
  type InterruptResult,
} from './compute/python-kernel';
import type { MaintenanceProgress } from '../shared/maintenance';

/** How a command reports progress + its terminal frame. Injected so the
 *  operations stay Electron-free and unit-testable. */
export type EmitMaintenance = (progress: MaintenanceProgress) => void;

/** Backfill's own finer-grained progress, reported alongside the maintenance
 *  frames so the status bar can show embedding counts. */
export type EmitBackfill = (progress: { done: number; total: number; running: boolean }) => void;

/** Why an interrupt didn't happen, in the user's terms rather than the kernel's. */
export function interruptReason(reason: Extract<InterruptResult, { ok: false }>['reason']): string {
  switch (reason) {
    case 'no-kernel': return 'No Python kernel is running — nothing to interrupt';
    case 'unsupported-platform': return 'Interrupting a cell isn\'t supported on Windows';
    default: return 'Couldn\'t interrupt the running cell';
  }
}

/**
 * Full reindex: graph + search + the DuckDB table overlays.
 *
 * Resolves `true` when the rebuild finished, so the caller knows whether to
 * refresh the table panels — refreshing off a failed run would show a
 * half-built table list. (`runMaintenance` never throws; it returns `undefined`
 * on failure, because its original caller was a menu click with nobody to
 * catch.)
 */
export async function rebuildAllIndexes(
  rootPath: string,
  emit: EmitMaintenance,
): Promise<boolean> {
  const ctx = projectContext(rootPath);
  const result = await runMaintenance({
    task: 'rebuildIndexes',
    label: 'Rebuilding indexes',
    // Blocking: indexAllNotes resets the rdflib store and refills it, so
    // anything the user does mid-rebuild reads a half-built graph.
    style: 'blocking',
    emit,
    run: async (report) => {
      // registerAllCsvs writes to the rdflib store that indexAllNotes
      // resets+rebuilds; sequence it after so its CSV-schema triples can't
      // land in the discarded store. search is independent (MiniSearch).
      // Mirrors acquireProject (see project-context.ts).
      const [notes] = await Promise.all([
        graph.indexAllNotes(ctx, { onProgress: report }),
        search.indexAllNotes(ctx),
      ]);
      await tables.registerAllCsvs(ctx);
      // Note tables after CSVs — CSV wins on a shared name (#1358).
      await tables.registerAllNoteTables(ctx);
      return notes;
    },
    summary: (notes) => `Rebuilt indexes — ${pluralizeNotes(notes)}`,
  });
  return result !== undefined;
}

/**
 * Force a full re-embed of the corpus (#836) — useful after suspected
 * corruption or to repopulate from scratch. Normal model-change / new-note
 * backfill is automatic on project open, so this is the explicit escape hatch.
 */
export async function rebuildSemanticIndex(
  rootPath: string,
  emit: EmitMaintenance,
  emitBackfill: EmitBackfill,
): Promise<void> {
  await runMaintenance({
    task: 'rebuildSemanticIndex',
    label: 'Rebuilding semantic index',
    // Background: embedding disturbs nothing the user can see, so it keeps its
    // quiet status-bar progress rather than an overlay.
    style: 'background',
    emit,
    run: async () => {
      let embedded = 0;
      await runBackfill(projectContext(rootPath), {
        force: true,
        onProgress: (p) => {
          embedded = p.done;
          emitBackfill(p);
        },
      });
      return embedded;
    },
    summary: (embedded) => `Rebuilt semantic index — ${pluralizeNotes(embedded)} embedded`,
  });
}

/** Interrupt the running Python cell. */
export async function interruptCell(rootPath: string, emit: EmitMaintenance): Promise<void> {
  await runMaintenance({
    task: 'interruptCell',
    label: 'Interrupting cell',
    style: 'background',
    emit,
    // The result was dropped on the floor before (#1814), so asking to
    // interrupt with no kernel running — or on Windows, where SIGINT isn't
    // available — looked exactly like a successful interrupt.
    run: () => Promise.resolve(interruptPythonKernel(rootPath)),
    summary: (result) => (result.ok ? 'Interrupted the running cell' : interruptReason(result.reason)),
  });
}

/** Restart the project's Python kernel. */
export async function restartKernel(rootPath: string, emit: EmitMaintenance): Promise<void> {
  await runMaintenance({
    task: 'restartKernel',
    label: 'Restarting Python kernel',
    style: 'blocking',
    emit,
    run: async () => { await restartPythonKernel(rootPath); },
    summary: () => 'Python kernel restarted',
  });
}

/**
 * Serialize the whole graph to `destPath` (#2233).
 *
 * There were two of these. `menu.ts` called `graph.exportGraph`, which
 * persists and then serializes the LIVE store — ontology triples included.
 * `GRAPH_EXPORT` in `register-graph.ts` persisted and then copied
 * `.minerva/graph.ttl`, which `persistGraph` deliberately writes WITHOUT the
 * ontology (it's reloaded from the embedded resource on startup). Same
 * user-facing command, two different files out, depending on which surface you
 * reached it from — and nothing compared them, because the menu path had no
 * contract entry to compare against.
 *
 * This keeps the menu's behaviour, which is the one users actually exercised
 * (the `GRAPH_EXPORT` channel is exposed in preload but has no renderer call
 * site) and the better answer for an export: a self-contained Turtle file that
 * describes its own vocabulary, rather than one that silently depends on
 * Minerva's embedded ontology to be interpretable.
 */
export async function exportKnowledgeGraph(rootPath: string, destPath: string): Promise<void> {
  await graph.exportGraph(projectContext(rootPath), destPath);
}
