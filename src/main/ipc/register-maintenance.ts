/**
 * Maintenance command handlers (#2233, epic #2241).
 *
 * The four long-running project operations, as typed channels. They were
 * `await`-ing bodies inside `menu.ts` click handlers, which made the native
 * menu a command surface with none of the discipline this layer has — no
 * channel constant, no `ChannelMap` entry, no preload method, no client
 * signature, no registrar test, and a `projectContext(rootPath)` built by hand
 * from a raw string.
 *
 * The operations themselves live in `../maintenance-commands`; this file is the
 * IPC surface over them and `menu.ts` is the other caller. Neither owns the
 * logic, which is the point: the previous arrangement let "Export Knowledge
 * Graph" mean two different output files depending on which surface you used
 * (see `exportKnowledgeGraph` for that story — its channel stays in
 * `register-graph.ts`, where the graph domain already lives).
 *
 * Progress reaches the renderer the way it always has: `broadcastMaintenance-
 * Progress` / `broadcastBackfillProgress` fan out to every window on the
 * project, which is what makes these safe to trigger from either surface.
 */
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import { withRootPath } from './helpers';
import { broadcastMaintenanceProgress, broadcastBackfillProgress } from '../window-manager';
import {
  rebuildAllIndexes,
  rebuildSemanticIndex,
  interruptCell,
  restartKernel,
} from '../maintenance-commands';

export function registerMaintenance(): void {
  handle(Channels.MAINTENANCE_REBUILD_INDEXES, withRootPath((rootPath) =>
    rebuildAllIndexes(rootPath, (p) => broadcastMaintenanceProgress(rootPath, p))));

  handle(Channels.MAINTENANCE_REBUILD_SEMANTIC_INDEX, withRootPath((rootPath) =>
    rebuildSemanticIndex(
      rootPath,
      (p) => broadcastMaintenanceProgress(rootPath, p),
      (p) => broadcastBackfillProgress(rootPath, p),
    )));

  handle(Channels.MAINTENANCE_INTERRUPT_CELL, withRootPath((rootPath) =>
    interruptCell(rootPath, (p) => broadcastMaintenanceProgress(rootPath, p))));

  handle(Channels.MAINTENANCE_RESTART_KERNEL, withRootPath((rootPath) =>
    restartKernel(rootPath, (p) => broadcastMaintenanceProgress(rootPath, p))));
}
