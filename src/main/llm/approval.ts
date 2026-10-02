// The approval engine: policy + proposal lifecycle orchestration.
//
// Split into three modules (#1083): this file owns approval-tier policy and the
// propose/approve/reject/expire orchestration; `apply-dispatch.ts` owns the
// per-kind apply/rollback handlers (a self-registering payload-kind registry —
// adding a kind needs no edit here); `proposal-persistence.ts` owns the graph
// writes, queries, and serialization. Types live in `proposal-types.ts`.
//
// This file remains the public entry point: it re-exports the types, the
// persistence queries (getProposal/listProposals), and stripTurtleCodeFence so
// existing `import … from './llm/approval'` sites keep working unchanged.

import * as graph from '../graph/index';
import { DAY_MS } from '../../shared/time';
import type { ProjectContext } from '../project-context-types';
import type {
  ApproveResult,
  AppliedRecord,
  RenameStep,
  Proposal,
  ProposalPayload,
  ProposedWrite,
} from './proposal-types';
import { applyBundle, assertPayloadPaths, collectAffectsNodes, wiredPayloadKinds } from './apply-dispatch';
import { runWithHistorySource } from '../history';
import { proposalCause } from './proposal-cause';
import { emitProposalsChanged } from './proposal-events';
import {
  getProposal,
  proposalUri,
  updateProposalStatus,
  writeProposalToGraph,
} from './proposal-persistence';
import { logger } from '../../shared/logger';
import { createProjectStore } from '../project-store';

// Re-export the public surface so importers of './llm/approval' are unaffected
// by the split.
export type {
  ApproveResult,
  RenameStep,
  OperationType,
  Proposal,
  ProposalPayload,
  ProposedWrite,
} from './proposal-types';
export { getProposal, listProposals, stripTurtleCodeFence } from './proposal-persistence';

/**
 * Reject a bundle containing a payload kind that has no apply handler (#665).
 * Without this, an un-wired kind (`source` / `saved-query`) could be filed as a
 * pending proposal and only blow up when the user clicks Approve. Fail fast at
 * creation instead, so a skill emitting an unsupported kind surfaces the bug
 * immediately rather than at the user's approve click.
 */
function assertWiredPayloads(payloads: ProposalPayload[]): void {
  const wired = wiredPayloadKinds();
  for (const p of payloads) {
    if (!wired.has(p.kind)) {
      throw new Error(
        `proposeWrite: payload kind "${p.kind}" has no apply dispatcher yet — ` +
        `filing this proposal would fail at approval time. ` +
        `Wired kinds: ${[...wired].join(', ')}.`,
      );
    }
  }
}

// ── Proposal lifecycle ───────────────────────────────────────────────────────

/**
 * Submit a proposed bundle. Every write is filed as a *pending* `thought:Proposal`
 * and applied only when the user approves it — the Trust Principle invariant:
 * the LLM proposes, the human confirms. There are no lower-trust tiers, so an
 * established-node escalation is unnecessary (nothing can bypass review to begin
 * with). Returns the pending proposal.
 */
export async function proposeWrite(ctx: ProjectContext, write: ProposedWrite): Promise<Proposal> {
  assertWiredPayloads(write.payloads);
  assertPayloadPaths(ctx, write.payloads);
  const now = new Date().toISOString();
  const expiryDate = new Date(Date.now() + (write.expiryDays ?? 7) * DAY_MS).toISOString();

  const proposal: Proposal = {
    uri: proposalUri(),
    status: 'pending',
    operationType: write.operationType,
    payloads: write.payloads,
    note: write.note,
    affectsNodeUris: collectAffectsNodes(ctx, write.payloads),
    conversationUri: write.conversationUri,
    proposedBy: write.proposedBy,
    proposedAt: now,
    autoExpires: expiryDate,
  };

  await writeProposalToGraph(ctx, proposal);
  emitProposalsChanged(ctx.rootPath);
  return proposal;
}

// ── Per-URI in-flight guard (#2361) ─────────────────────────────────────────
//
// `approveProposal` reads the status, awaits `applyBundle` (file + graph I/O),
// and only then writes `approved`. Two overlapping calls for one URI both used
// to pass the `pending` check and apply the bundle twice. Callers are not just
// the Proposals panel — auto-tag, auto-link, set/source-properties and the
// conversation draft filer all call in directly — so the guard lives here.
//
// Semantics:
//   - Same op, same URI (approve ‖ approve, reject ‖ reject): the second caller
//     JOINS the first — it gets the first call's promise, so the bundle is
//     applied once and both callers see the real outcome (the same `filedPaths`
//     / `rewrittenPaths`, or the same error). An "already in progress"
//     `ok: false` was the alternative, but every caller reads `ok: false` as
//     "nothing was applied", which would be a lie while the first call is
//     mid-apply and about to succeed.
//   - Different ops, same URI (approve ‖ reject): the later one waits for the
//     earlier to SETTLE, then runs its own status check. The status is no
//     longer `pending`, so it declines normally (`ok: false` / `false`). If the
//     earlier one failed, the proposal is still pending and the later one
//     proceeds — which is exactly what a retry should do.
//
// The entry is registered synchronously (before the first `await`), so even a
// `Promise.all([approve(u), approve(u)])` sees it; it is removed in a `finally`
// on success AND failure, so a failed approval can be retried. The map is
// per-project and lives in a `createProjectStore` slot (#2240); a lookup does
// not allocate one — only starting an operation does.

interface ProposalOpResults {
  approve: ApproveResult;
  reject: boolean;
}
type ProposalOp = keyof ProposalOpResults;

interface InFlight {
  op: ProposalOp;
  promise: Promise<unknown>;
}

const inFlightStore = createProjectStore<Map<string, InFlight>>();

function inFlightSlot(ctx: ProjectContext): Map<string, InFlight> {
  let slot = inFlightStore.get(ctx);
  if (!slot) {
    slot = new Map();
    inFlightStore.set(ctx, slot);
  }
  return slot;
}

function runExclusive<K extends ProposalOp>(
  ctx: ProjectContext,
  uri: string,
  op: K,
  run: () => Promise<ProposalOpResults[K]>,
): Promise<ProposalOpResults[K]> {
  const current = inFlightStore.get(ctx)?.get(uri);
  if (current) {
    if (current.op === op) return current.promise as Promise<ProposalOpResults[K]>;
    // A different op on this URI is mid-flight: let it settle (either way),
    // then re-enter so this call re-checks status against its outcome.
    const settled = current.promise.then(() => undefined, () => undefined);
    return settled.then(() => runExclusive(ctx, uri, op, run));
  }
  // Capture the slot: if the project is disposed mid-flight, cleanup still
  // targets the map this entry was registered in, not a fresh one.
  const slot = inFlightSlot(ctx);
  // `.then(run)` defers `run` a microtask and `.finally` always runs
  // asynchronously, so the entry is in the map before either can observe it.
  const promise = Promise.resolve()
    .then(run)
    .finally(() => {
      if (slot.get(uri)?.promise === promise) slot.delete(uri);
    });
  slot.set(uri, { op, promise });
  return promise;
}

/** Test-only: URIs with an approve/reject currently in flight for `ctx`. */
export function _inFlightProposalUrisForTests(ctx: ProjectContext): string[] {
  return [...(inFlightStore.get(ctx)?.keys() ?? [])];
}

/**
 * Approve a pending proposal: apply its bundle and update status.
 *
 * Concurrency-safe per URI (#2361): a second call for the same URI while one is
 * in flight returns the first call's result instead of applying again; a call
 * racing a `rejectProposal` for the same URI waits for it and then declines.
 */
export function approveProposal(ctx: ProjectContext, uri: string): Promise<ApproveResult> {
  return runExclusive(ctx, uri, 'approve', () => approvePending(ctx, uri));
}

async function approvePending(ctx: ProjectContext, uri: string): Promise<ApproveResult> {
  const proposal = await getProposal(ctx, uri);
  if (!proposal || proposal.status !== 'pending') return { ok: false, filedPaths: [], rewrittenPaths: [], renames: [] };

  if (proposal.payloads.length === 0) {
    // Don't quietly flip status to approved on an empty bundle — that's
    // the silent-no-op the user hit. Either the proposal was filed wrong,
    // or its payload JSON is broken. Either way the user deserves to see it.
    throw new Error(
      `Proposal ${uri} has no payloads to apply. Refusing to approve it as a no-op.`,
    );
  }

  logger('approval').info(
    `applying ${proposal.payloads.length} payload(s) for ${uri}: ` +
    proposal.payloads.map((p) => p.kind).join(', '),
  );

  // Record the note revisions this apply produces under the user-facing name of
  // whatever caused them ("Auto-tag", "Antithesize"), so the History panel can
  // say what happened rather than just "AI".
  const applied = await runWithHistorySource(
    { origin: 'proposal', cause: await proposalCause(ctx, proposal) },
    () => applyBundle(ctx, proposal.payloads),
  );
  await updateProposalStatus(ctx, uri, 'approved');
  emitProposalsChanged(ctx.rootPath);
  const filedPaths = applied
    .filter((a): a is AppliedRecord & { kind: 'note' } => a.kind === 'note')
    .map((a) => (a.rollbackData as { resolvedPath: string }).resolvedPath);
  const rewrittenPaths = applied
    .filter((a): a is AppliedRecord & { kind: 'note-rewrite' } => a.kind === 'note-rewrite')
    .map((a) => (a.rollbackData as { path: string }).path);
  // Note/folder moves (#2541): what they moved, and whose links they rewrote.
  const renames: RenameStep[] = [];
  for (const a of applied) {
    if (a.kind !== 'note-refactor' && a.kind !== 'folder-refactor') continue;
    const r = a.rollbackData as { fromPath: string; toPath: string; transitions: Array<{ old: string; new: string }>; rewrittenPaths: string[] };
    renames.push(a.kind === 'folder-refactor'
      ? [...r.transitions, { old: r.fromPath, new: r.toPath, folder: true }]
      : [...r.transitions]);
    for (const p of r.rewrittenPaths) if (!rewrittenPaths.includes(p)) rewrittenPaths.push(p);
  }
  return { ok: true, filedPaths, rewrittenPaths, renames };
}

/**
 * Reject a pending proposal: update status without applying. Serialized per URI
 * against `approveProposal` the same way (#2361), so a reject racing an approve
 * can never flip an applied proposal to `rejected` or vice versa.
 */
export function rejectProposal(ctx: ProjectContext, uri: string): Promise<boolean> {
  return runExclusive(ctx, uri, 'reject', () => rejectPending(ctx, uri));
}

async function rejectPending(ctx: ProjectContext, uri: string): Promise<boolean> {
  const proposal = await getProposal(ctx, uri);
  if (!proposal || proposal.status !== 'pending') return false;

  await updateProposalStatus(ctx, uri, 'rejected');
  emitProposalsChanged(ctx.rootPath);
  return true;
}

/**
 * Expire proposals past their autoExpires date.
 */
export async function expireProposals(ctx: ProjectContext): Promise<number> {
  const results = await graph.queryGraphRows(ctx, `
    SELECT ?proposal ?expires WHERE {
      ?proposal a thought:Proposal .
      ?proposal thought:proposalStatus thought:pending .
      ?proposal thought:autoExpires ?expires .
    }
  `);

  const now = new Date();
  let count = 0;
  for (const row of results.results as Record<string, string>[]) {
    // ?expires and ?proposal are required (non-OPTIONAL) bindings in the query.
    const expires = new Date(row.expires!);
    if (expires <= now) {
      await updateProposalStatus(ctx, row.proposal!, 'expired');
      count++;
    }
  }
  if (count > 0) emitProposalsChanged(ctx.rootPath);
  return count;
}
