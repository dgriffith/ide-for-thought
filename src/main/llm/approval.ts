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
import type { ProjectContext } from '../project-context-types';
import type {
  ApprovalTier,
  ApproveResult,
  AppliedRecord,
  OperationType,
  Proposal,
  ProposalPayload,
  ProposedWrite,
} from './proposal-types';
import { applyBundle, collectAffectsNodes, wiredPayloadKinds } from './apply-dispatch';
import {
  getProposal,
  proposalUri,
  updateProposalStatus,
  writeProposalToGraph,
} from './proposal-persistence';

// Re-export the public surface so importers of './llm/approval' are unaffected
// by the split.
export type {
  ApprovalTier,
  ApproveResult,
  OperationType,
  Proposal,
  ProposalPayload,
  ProposedWrite,
} from './proposal-types';
export { getProposal, listProposals, stripTurtleCodeFence } from './proposal-persistence';

// ── Default Policy ─────────────────────────────────────────────────────────

const DEFAULT_POLICY: Record<OperationType, ApprovalTier> = {
  new_claim: 'requires_approval',
  evidence_link: 'requires_approval',
  component_creation: 'requires_approval',
  confidence_update: 'notify_only',
  status_change: 'notify_only',
  tag_addition: 'autonomous',
  staleness_flag: 'autonomous',
  // A move/rename restructures the vault + rewrites links across notes — always
  // reviewed (#911).
  note_refactor: 'requires_approval',
  // Deleting a note is destructive — always reviewed, never autonomous.
  note_delete: 'requires_approval',
  // Rewriting a note's body in place replaces human-authored content — always
  // reviewed via the diff card (#936).
  note_rewrite: 'requires_approval',
  // Upserting LLM-proposed source metadata (abstract / TL;DR) — reviewed via the
  // source-property card (#943).
  source_properties: 'requires_approval',
};

let policyOverrides: Partial<Record<OperationType, ApprovalTier>> = {};

export function getApprovalTier(operationType: OperationType): ApprovalTier {
  return policyOverrides[operationType] ?? DEFAULT_POLICY[operationType] ?? 'requires_approval';
}

export function setPolicy(operationType: OperationType, tier: ApprovalTier): void {
  policyOverrides[operationType] = tier;
}

export function resetPolicy(): void {
  policyOverrides = {};
}

// ── Established-node escalation ──────────────────────────────────────────────

/**
 * The Trust Principle's established-node escalation (#656): a write that
 * touches any human-vetted (`thought:hasStatus thought:established`) node
 * escalates to `requires_approval` regardless of its operation type — so the
 * LLM can't silently re-tag, flag, or otherwise mutate an established claim
 * via an `autonomous`/`notify_only` op. Returns true if any of `uris` is
 * established.
 */
async function anyNodeEstablished(ctx: ProjectContext, uris: string[]): Promise<boolean> {
  if (uris.length === 0) return false;
  const values = uris.map((u) => `<${u}>`).join(' ');
  const r = await graph.queryGraph(ctx, `
    SELECT ?n WHERE {
      VALUES ?n { ${values} }
      ?n thought:hasStatus thought:established .
    } LIMIT 1
  `);
  return r.results.length > 0;
}

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
 * Submit a proposed bundle. Based on the operation's approval tier:
 * - requires_approval: persists a pending Proposal, returns it.
 * - notify_only: applies the bundle immediately, persists an approved
 *   Proposal for audit.
 * - autonomous: applies the bundle immediately, no proposal record.
 */
export async function proposeWrite(ctx: ProjectContext, write: ProposedWrite): Promise<Proposal | null> {
  assertWiredPayloads(write.payloads);
  let tier = getApprovalTier(write.operationType);
  const now = new Date().toISOString();
  const expiryDate = new Date(Date.now() + (write.expiryDays ?? 7) * 86400000).toISOString();

  // Established-node escalation (#656). Computed before the tier dispatch so it
  // can pull an autonomous/notify_only write up to requires_approval when it
  // touches a human-vetted node — the Trust Principle invariant CLAUDE.md
  // documents. Collected here (not after the autonomous return) so the check
  // covers autonomous ops too.
  const affectsNodeUris = collectAffectsNodes(ctx, write.payloads);
  if (tier !== 'requires_approval' && await anyNodeEstablished(ctx, affectsNodeUris)) {
    tier = 'requires_approval';
  }

  if (tier === 'autonomous') {
    await applyBundle(ctx, write.payloads);
    return null;
  }

  const uri = proposalUri();
  const proposal: Proposal = {
    uri,
    status: tier === 'notify_only' ? 'approved' : 'pending',
    operationType: write.operationType,
    payloads: write.payloads,
    note: write.note,
    affectsNodeUris,
    conversationUri: write.conversationUri,
    proposedBy: write.proposedBy,
    proposedAt: now,
    autoExpires: expiryDate,
  };

  await writeProposalToGraph(ctx, proposal);

  if (tier === 'notify_only') {
    await applyBundle(ctx, write.payloads);
  }

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

  const applied = await applyBundle(ctx, proposal.payloads);
  await updateProposalStatus(ctx, uri, 'approved');
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
  return count;
}
