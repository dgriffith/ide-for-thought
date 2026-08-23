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
import { DAY_MS } from '../graph/queries';
import type { ProjectContext } from '../project-context-types';
import type {
  ApproveResult,
  AppliedRecord,
  Proposal,
  ProposalPayload,
  ProposedWrite,
} from './proposal-types';
import { applyBundle, collectAffectsNodes, wiredPayloadKinds } from './apply-dispatch';
import { runWithHistorySource } from '../history';
import { proposalCause } from './proposal-cause';
import { emitProposalsChanged } from './proposal-events';
import {
  getProposal,
  proposalUri,
  updateProposalStatus,
  writeProposalToGraph,
} from './proposal-persistence';

// Re-export the public surface so importers of './llm/approval' are unaffected
// by the split.
export type {
  ApproveResult,
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

/**
 * Approve a pending proposal: apply its bundle and update status.
 */
export async function approveProposal(ctx: ProjectContext, uri: string): Promise<ApproveResult> {
  const proposal = await getProposal(ctx, uri);
  if (!proposal || proposal.status !== 'pending') return { ok: false, filedPaths: [], rewrittenPaths: [] };

  if (proposal.payloads.length === 0) {
    // Don't quietly flip status to approved on an empty bundle — that's
    // the silent-no-op the user hit. Either the proposal was filed wrong,
    // or its payload JSON is broken. Either way the user deserves to see it.
    throw new Error(
      `Proposal ${uri} has no payloads to apply. Refusing to approve it as a no-op.`,
    );
  }

  console.log(
    `[approval] applying ${proposal.payloads.length} payload(s) for ${uri}: ` +
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
  return { ok: true, filedPaths, rewrittenPaths };
}

/**
 * Reject a pending proposal: update status without applying.
 */
export async function rejectProposal(ctx: ProjectContext, uri: string): Promise<boolean> {
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
  const results = await graph.queryGraph(ctx, `
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
