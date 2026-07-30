/**
 * Pure validation for a base-IRI rebase (#1443 Part B). Kept separate from the
 * IPC handler so it's unit-testable without a live graph: the new base must be
 * an absolute http(s) IRI ending in '/'. (Proposals are rewritten old→new
 * during the rebuild — see indexAllNotes `rebaseFrom` — so, unlike the original
 * design, a non-empty review queue is no longer a blocker.)
 */
export type RebaseCheck = { ok: true; uri: string } | { ok: false; error: string };

export function checkRebase(uri: string): RebaseCheck {
  const trimmed = (uri ?? '').trim();
  if (!/^https?:\/\/\S+\/$/.test(trimmed)) {
    return { ok: false, error: 'Base IRI must be an absolute http(s) URL ending in "/".' };
  }
  return { ok: true, uri: trimmed };
}
