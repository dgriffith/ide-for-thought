import * as graph from '../graph/index';
import type { ProjectContext } from '../project-context-types';

// ── Types ──────────────────────────────────────────────────────────────────

export type ApprovalTier = 'requires_approval' | 'notify_only' | 'autonomous';

export type OperationType =
  | 'new_claim'
  | 'evidence_link'
  | 'confidence_update'
  | 'tag_addition'
  | 'staleness_flag'
  | 'component_creation'
  | 'status_change';

export interface ProposedWrite {
  /** The operation type for policy lookup */
  operationType: OperationType;
  /** Turtle representation of the triples to add */
  turtleDiff: string;
  /** Human-readable description */
  note: string;
  /**
   * URIs of the nodes being created or modified by this proposal. The
   * "Trust: Unreviewed LLM writes" stock query joins on
   * `thought:affectsNode`, so every component the proposal mutates must
   * appear here for the integrity check to find the proposal.
   */
  affectsNodeUris?: string[];
  /** URI of the conversation that produced this proposal */
  conversationUri?: string;
  /** Agent identifier */
  proposedBy: string;
  /** Auto-expiry duration in days (default: 7) */
  expiryDays?: number;
}

export interface Proposal {
  uri: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  operationType: string;
  turtleDiff: string;
  note: string;
  affectsNodeUris: string[];
  conversationUri?: string;
  proposedBy: string;
  proposedAt: string;
  autoExpires: string;
}

// ── Default Policy ─────────────────────────────────────────────────────────

const DEFAULT_POLICY: Record<OperationType, ApprovalTier> = {
  new_claim: 'requires_approval',
  evidence_link: 'requires_approval',
  component_creation: 'requires_approval',
  confidence_update: 'notify_only',
  status_change: 'notify_only',
  tag_addition: 'autonomous',
  staleness_flag: 'autonomous',
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

// ── Proposal Management ────────────────────────────────────────────────────

const THOUGHT = 'https://minerva.dev/ontology/thought#';

function proposalUri(): string {
  return `${THOUGHT}proposal/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Submit a proposed graph write. Based on the operation's approval tier:
 * - requires_approval: creates a pending Proposal in the graph, returns it
 * - notify_only: applies the write immediately, creates an approved Proposal for audit
 * - autonomous: applies the write immediately, no proposal record
 */
export async function proposeWrite(ctx: ProjectContext, write: ProposedWrite): Promise<Proposal | null> {
  const tier = getApprovalTier(write.operationType);
  const now = new Date().toISOString();
  const expiryDate = new Date(Date.now() + (write.expiryDays ?? 7) * 86400000).toISOString();

  if (tier === 'autonomous') {
    // Apply immediately, no record
    await applyTurtle(ctx, write.turtleDiff);
    return null;
  }

  const uri = proposalUri();
  const proposal: Proposal = {
    uri,
    status: tier === 'notify_only' ? 'approved' : 'pending',
    operationType: write.operationType,
    turtleDiff: write.turtleDiff,
    note: write.note,
    affectsNodeUris: write.affectsNodeUris ?? [],
    conversationUri: write.conversationUri,
    proposedBy: write.proposedBy,
    proposedAt: now,
    autoExpires: expiryDate,
  };

  // Write proposal metadata to graph
  await writeProposalToGraph(ctx, proposal);

  // For notify_only, also apply the mutation immediately
  if (tier === 'notify_only') {
    await applyTurtle(ctx, write.turtleDiff);
  }

  return proposal;
}

/**
 * Approve a pending proposal: apply its turtle diff and update status.
 */
export async function approveProposal(ctx: ProjectContext, uri: string): Promise<boolean> {
  const proposal = await getProposal(ctx, uri);
  if (!proposal || proposal.status !== 'pending') return false;

  await applyTurtle(ctx, proposal.turtleDiff);
  await updateProposalStatus(ctx, uri, 'approved');
  return true;
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
    PREFIX thought: <${THOUGHT}>
    SELECT ?proposal ?expires WHERE {
      ?proposal a thought:Proposal .
      ?proposal thought:proposalStatus thought:pending .
      ?proposal thought:autoExpires ?expires .
    }
  `);

  const now = new Date();
  let count = 0;
  for (const row of results.results as Record<string, string>[]) {
    const expires = new Date(row.expires);
    if (expires <= now) {
      await updateProposalStatus(ctx, row.proposal, 'expired');
      count++;
    }
  }
  return count;
}

/**
 * List proposals, optionally filtered by status.
 */
export async function listProposals(ctx: ProjectContext, status?: string): Promise<Proposal[]> {
  const statusFilter = status
    ? `?proposal thought:proposalStatus thought:${status} .`
    : '';

  const results = await graph.queryGraph(ctx, `
    PREFIX thought: <${THOUGHT}>
    SELECT ?proposal ?status ?operationType ?note ?proposedBy ?proposedAt ?autoExpires ?turtleDiff
           (GROUP_CONCAT(DISTINCT ?affectsNode; separator="\\u001f") AS ?affectsNodes)
           ?conversation WHERE {
      ?proposal a thought:Proposal .
      ?proposal thought:proposalStatus ?statusNode .
      BIND(REPLACE(STR(?statusNode), "${THOUGHT}", "") AS ?status)
      ?proposal thought:operationType ?operationType .
      ?proposal thought:proposalNote ?note .
      ?proposal thought:proposedBy ?proposedBy .
      ?proposal thought:proposedAt ?proposedAt .
      ?proposal thought:autoExpires ?autoExpires .
      ?proposal thought:proposalDiff ?turtleDiff .
      ${statusFilter}
      OPTIONAL { ?proposal thought:affectsNode ?affectsNode }
      OPTIONAL { ?proposal thought:conversationRef ?conversation }
    }
    GROUP BY ?proposal ?status ?operationType ?note ?proposedBy ?proposedAt ?autoExpires ?turtleDiff ?conversation
    ORDER BY DESC(?proposedAt)
  `);

  return (results.results as Record<string, string>[]).map(r => ({
    uri: r.proposal,
    status: r.status as Proposal['status'],
    operationType: r.operationType,
    turtleDiff: r.turtleDiff,
    note: r.note,
    affectsNodeUris: splitAffectsNodes(r.affectsNodes),
    conversationUri: r.conversation,
    proposedBy: r.proposedBy,
    proposedAt: r.proposedAt,
    autoExpires: r.autoExpires,
  }));
}

/**
 * Get a single proposal by URI.
 */
export async function getProposal(ctx: ProjectContext, uri: string): Promise<Proposal | null> {
  const results = await graph.queryGraph(ctx, `
    PREFIX thought: <${THOUGHT}>
    SELECT ?status ?operationType ?note ?proposedBy ?proposedAt ?autoExpires ?turtleDiff ?affectsNode ?conversation WHERE {
      <${uri}> a thought:Proposal .
      <${uri}> thought:proposalStatus ?statusNode .
      BIND(REPLACE(STR(?statusNode), "${THOUGHT}", "") AS ?status)
      <${uri}> thought:operationType ?operationType .
      <${uri}> thought:proposalNote ?note .
      <${uri}> thought:proposedBy ?proposedBy .
      <${uri}> thought:proposedAt ?proposedAt .
      <${uri}> thought:autoExpires ?autoExpires .
      <${uri}> thought:proposalDiff ?turtleDiff .
      OPTIONAL { <${uri}> thought:affectsNode ?affectsNode }
      OPTIONAL { <${uri}> thought:conversationRef ?conversation }
    }
  `);

  const rows = results.results as Record<string, string>[];
  if (rows.length === 0) return null;

  const r = rows[0];
  // Multiple affectsNode rows show up as multiple result rows (one per URI).
  // Collect them all rather than just the first.
  const affectsNodeUris = Array.from(
    new Set(rows.map(row => row.affectsNode).filter((u): u is string => Boolean(u)))
  );
  return {
    uri,
    status: r.status as Proposal['status'],
    operationType: r.operationType,
    turtleDiff: r.turtleDiff,
    note: r.note,
    affectsNodeUris,
    conversationUri: r.conversation,
    proposedBy: r.proposedBy,
    proposedAt: r.proposedAt,
    autoExpires: r.autoExpires,
  };
}

/** Split the GROUP_CONCAT result for affectsNode URIs back into a list. */
function splitAffectsNodes(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split('').filter(Boolean);
}

// ── Internal Helpers ───────────────────────────────────────────────────────

async function writeProposalToGraph(ctx: ProjectContext, p: Proposal): Promise<void> {
  const affectsNodeTriples = p.affectsNodeUris
    .map(u => `; thought:affectsNode <${u}>`)
    .join('\n      ');
  const turtle = `
    <${p.uri}> a thought:Proposal ;
      thought:proposalStatus thought:${p.status} ;
      thought:operationType "${escapeTurtle(p.operationType)}" ;
      thought:proposalNote "${escapeTurtle(p.note)}" ;
      thought:proposedBy "${escapeTurtle(p.proposedBy)}" ;
      thought:proposedAt "${p.proposedAt}"^^xsd:dateTime ;
      thought:autoExpires "${p.autoExpires}"^^xsd:dateTime ;
      thought:proposalDiff "${escapeTurtle(p.turtleDiff)}"
      ${affectsNodeTriples}
      ${p.conversationUri ? `; thought:conversationRef <${p.conversationUri}>` : ''} .
  `;
  await applyTurtle(ctx, turtle);
}

async function updateProposalStatus(ctx: ProjectContext, uri: string, newStatus: string): Promise<void> {
  // Drop any prior thought:proposalStatus triples on this proposal
  // before adding the new one — otherwise the proposal accumulates
  // {pending, approved, ...} markers and history queries return all
  // historical states (#332).
  graph.enterTrustedContext();
  try {
    graph.removeMatchingTriples(ctx, uri, `${THOUGHT}proposalStatus`);
  } finally {
    graph.exitTrustedContext();
  }
  await applyTurtle(ctx, `<${uri}> thought:proposalStatus thought:${newStatus} .`);
}

async function applyTurtle(ctx: ProjectContext, turtle: string): Promise<void> {
  // Use the graph module's parse infrastructure with standard prefixes
  const prefixed = `
    @prefix thought: <${THOUGHT}> .
    @prefix minerva: <https://minerva.dev/ontology#> .
    @prefix dc: <http://purl.org/dc/terms/> .
    @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    @prefix prov: <http://www.w3.org/ns/prov#> .
    ${turtle}
  `;
  // Approval engine writes are the *only* in-LLM-context writes that
  // shouldn't trip the trust guard. Everything else flowing through
  // parseIntoStore from an LLM call site is a bug we want to know about.
  graph.enterTrustedContext();
  try {
    graph.parseIntoStore(ctx, prefixed);
  } finally {
    graph.exitTrustedContext();
  }
  await graph.persistGraph(ctx);
}

function escapeTurtle(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
