/**
 * The wire shape of a proposal as it crosses IPC (`proposal:list` /
 * `proposal:detail`) and reaches the renderer — the serializable, renderer-safe
 * subset of the main-process `Proposal` (src/main/llm/proposal-types.ts). Kept
 * in `shared/` so the typed IPC contract, the preload bridge, and the renderer
 * store all name one type instead of the surface being `unknown` (#1632).
 *
 * `payloads` stays `unknown[]` at this boundary: the payload discriminated union
 * lives in the main process, and the review UI narrows each payload per-kind at
 * render time. Giving the payloads a shared union is a separate, larger effort.
 */
export interface Proposal {
  uri: string;
  /** `pending` | `approved` | `rejected` | `expired` — kept as a string because
   *  the proposals store filters on it client-side. */
  status: string;
  operationType: string;
  note: string;
  proposedBy: string;
  proposedAt: string;
  /** When the status last transitioned (approved/rejected/expired) — #1159.
   *  Absent on a still-pending proposal. */
  statusChangedAt?: string | undefined;
  payloads: unknown[];
}

/**
 * Why a proposal could not be approved or rejected — the EXPECTED outcomes a
 * reviewer can hit in normal use (#2362):
 *
 * - `not-found` — no proposal at that URI (swept, or a bad URI).
 * - `not-pending` — it exists but has already been resolved (`status` says
 *   how: approved / rejected / expired), e.g. a second click, another window
 *   acting first, or the expiry sweep getting there first.
 *
 * Genuine failures are NOT folded in here: "no project open" and an apply that
 * blows up (an empty bundle, a payload that can't be written) reject the IPC
 * call instead (CLAUDE.md IPC error handling, rules 1–3).
 */
export type ProposalDecisionFailure =
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'not-pending'; status: string };

/**
 * Result of `proposal:approve`. The call itself does not reject for the
 * expected outcomes in {@link ProposalDecisionFailure} — branch on `ok`. It
 * DOES reject when no project is open or when applying the bundle fails.
 *
 * On success, `filedPaths` / `rewrittenPaths` are the project-relative notes
 * the bundle created / rewrote in place (the main-process `ApproveResult`).
 */
export type ProposalApproveResult =
  | { ok: true; filedPaths: string[]; rewrittenPaths: string[] }
  | ProposalDecisionFailure;

/**
 * Result of `proposal:reject`. Like {@link ProposalApproveResult}, the call
 * does not reject for an expected outcome — only for "no project open" or an
 * IO failure while recording the status.
 */
export type ProposalRejectResult = { ok: true } | ProposalDecisionFailure;

/** One-line, user-facing explanation of a {@link ProposalDecisionFailure}. */
export function describeProposalDecisionFailure(f: ProposalDecisionFailure): string {
  if (f.reason === 'not-found') {
    return 'No proposal exists at that URI any more — it may have been removed. Refresh to check.';
  }
  return `This proposal is no longer pending — it is already ${f.status}.`;
}
