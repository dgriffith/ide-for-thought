/**
 * Review-sidebar action chokepoint (#1086).
 *
 * The right-sidebar review panels list their data with read calls (allowed in
 * components) but route the actions that change state — approving/rejecting a
 * proposal, and (re)running the graph health checks — through here, per the
 * renderer data-flow rule (CLAUDE.md). Thin passthroughs.
 */
import { api } from '../ipc/client';

export function getReviewStore() {
  return {
    approveProposal: (uri: string) => api.proposals.approve(uri),
    rejectProposal: (uri: string) => api.proposals.reject(uri),
    /** Re-run every graph health check and return the fresh inspection list. */
    runInspections: () => api.graph.runInspections(),
  };
}
