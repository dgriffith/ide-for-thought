/**
 * Publication / export write chokepoint (#1086).
 *
 * ExportDialog and PublishDialog read exporter/target/plan metadata directly
 * (reads are allowed in components) but route the state-changing actions —
 * running an export, pushing to a git remote, and adding/removing publish
 * targets — through here, per the renderer data-flow rule (CLAUDE.md). Thin
 * passthroughs; the dialogs keep their own view state.
 */
import { api } from '../ipc/client';

export function getPublishStore() {
  return {
    runExport: (args: Parameters<typeof api.publish.runExport>[0]) =>
      api.publish.runExport(args),
    toGit: (targetId: string, opts?: { dryRun?: boolean }) => api.publish.toGit(targetId, opts),
    upsertTarget: (target: Parameters<typeof api.publish.upsertTarget>[0]) =>
      api.publish.upsertTarget(target),
    removeTarget: (id: string) => api.publish.removeTarget(id),
  };
}
