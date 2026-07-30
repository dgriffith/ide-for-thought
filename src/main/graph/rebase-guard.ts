/**
 * Pure precheck for a base-IRI rebase (#1443 Part B). Kept separate from the IPC
 * handler so the two load-bearing rules are unit-testable without a live graph:
 *   1. the new base must be an absolute http(s) IRI ending in '/', and
 *   2. the review queue must be empty — pending proposals reference notes by
 *      absolute IRI and are copied verbatim across the rebuild that a rebase
 *      triggers, so they'd dangle under the new base (the #1 invariant #1443
 *      flags). Clearing the queue first is the mitigation.
 */
export type RebaseCheck = { ok: true; uri: string } | { ok: false; error: string };

export function checkRebase(uri: string, pendingProposalCount: number): RebaseCheck {
  const trimmed = (uri ?? '').trim();
  if (!/^https?:\/\/\S+\/$/.test(trimmed)) {
    return { ok: false, error: 'Base IRI must be an absolute http(s) URL ending in "/".' };
  }
  if (pendingProposalCount > 0) {
    return {
      ok: false,
      error: `Resolve the ${pendingProposalCount} pending proposal${pendingProposalCount === 1 ? '' : 's'} in the review queue before changing the base IRI.`,
    };
  }
  return { ok: true, uri: trimmed };
}
