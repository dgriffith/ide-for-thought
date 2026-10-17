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
import { DEFAULT_PDF_PROFILE, isPdfProfile, type PdfProfile } from '../../../shared/export-pdf-profiles';

// A PDF's style profile (#2429), remembered per thoughtbase on this machine:
// a preference for how you like your exports, not something to share.
const profileKey = (root: string) => `export-pdf-profile:${root}`;

export function getPublishStore() {
  return {
    runExport: (args: Parameters<typeof api.publish.runExport>[0]) =>
      api.publish.runExport(args),
    toGit: (targetId: string, opts?: { dryRun?: boolean; createRepo?: { private: boolean }; approveRemote?: string }) =>
      api.publish.toGit(targetId, opts),
    upsertTarget: (target: Parameters<typeof api.publish.upsertTarget>[0]) =>
      api.publish.upsertTarget(target),
    removeTarget: (id: string) => api.publish.removeTarget(id),
    /** The PDF style profile last used in this thoughtbase, or Notes. */
    pdfProfileFor(root: string): PdfProfile {
      try {
        const saved = localStorage.getItem(profileKey(root));
        return isPdfProfile(saved) ? saved : DEFAULT_PDF_PROFILE;
      } catch {
        return DEFAULT_PDF_PROFILE; // storage unavailable: the default, every time
      }
    },
    rememberPdfProfile(root: string, profile: PdfProfile): void {
      try { localStorage.setItem(profileKey(root), profile); } catch { /* storage unavailable: not remembered */ }
    },
  };
}
