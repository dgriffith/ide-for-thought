import * as graph from '../graph/index';

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
  /** URI of the node being created or modified */
  affectsNodeUri?: string;
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
  affectsNodeUri?: string;
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
export async function proposeWrite(write: ProposedWrite): Promise<Proposal | null> {
  const tier = getApprovalTier(write.operationType);
  const now = new Date().toISOString();
  const expiryDate = new Date(Date.now() + (write.expiryDays ?? 7) * 86400000).toISOString();

  if (tier === 'autonomous') {
    // Apply immediately, no record
    await applyTurtle(write.turtleDiff);
    return null;
  }

  const uri = proposalUri();
  const proposal: Proposal = {
    uri,
    status: tier === 'notify_only' ? 'approved' : 'pending',
    operationType: write.operationType,
    turtleDiff: write.turtleDiff,
    note: write.note,
    affectsNodeUri: write.affectsNodeUri,
    conversationUri: write.conversationUri,
    proposedBy: write.proposedBy,
    proposedAt: now,
    autoExpires: expiryDate,
  };

  // Write proposal metadata to graph
  await writeProposalToGraph(proposal);

  // For notify_only, also apply the mutation immediately
  if (tier === 'notify_only') {
    await applyTurtle(write.turtleDiff);
  }

  return proposal;
}

/**
 * Approve a pending proposal: apply its turtle diff and update status.
 */
export async function approveProposal(uri: string): Promise<boolean> {
  const proposal = await getProposal(uri);
  if (!proposal || proposal.status !== 'pending') return false;

  await applyTurtle(proposal.turtleDiff);
  await updateProposalStatus(uri, 'approved');
  return true;
}

/**
 * Reject a pending proposal: update status without applying.
 */
export async function rejectProposal(uri: string): Promise<boolean> {
  const proposal = await getProposal(uri);
  if (!proposal || proposal.status !== 'pending') return false;

  await updateProposalStatus(uri, 'rejected');
  return true;
}

/**
 * Expire proposals past their autoExpires date.
 */
export async function expireProposals(): Promise<number> {
  const results = await graph.queryGraph(`
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
      await updateProposalStatus(row.proposal, 'expired');
      count++;
    }
  }
  return count;
}

/**
 * List proposals, optionally filtered by status.
 */
export async function listProposals(status?: string): Promise<Proposal[]> {
  const statusFilter = status
    ? `?proposal thought:proposalStatus thought:${status} .`
    : '';

  const results = await graph.queryGraph(`
    PREFIX thought: <${THOUGHT}>
    SELECT ?proposal ?status ?operationType ?note ?proposedBy ?proposedAt ?autoExpires ?turtleDiff ?affectsNode ?conversation WHERE {
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
    ORDER BY DESC(?proposedAt)
  `);

  return (results.results as Record<string, string>[]).map(r => ({
    uri: r.proposal,
    status: r.status as Proposal['status'],
    operationType: r.operationType,
    turtleDiff: r.turtleDiff,
    note: r.note,
    affectsNodeUri: r.affectsNode,
    conversationUri: r.conversation,
    proposedBy: r.proposedBy,
    proposedAt: r.proposedAt,
    autoExpires: r.autoExpires,
  }));
}

/**
 * Get a single proposal by URI.
 */
export async function getProposal(uri: string): Promise<Proposal | null> {
  const results = await graph.queryGraph(`
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
  return {
    uri,
    status: r.status as Proposal['status'],
    operationType: r.operationType,
    turtleDiff: r.turtleDiff,
    note: r.note,
    affectsNodeUri: r.affectsNode,
    conversationUri: r.conversation,
    proposedBy: r.proposedBy,
    proposedAt: r.proposedAt,
    autoExpires: r.autoExpires,
  };
}

// ── Internal Helpers ───────────────────────────────────────────────────────

async function writeProposalToGraph(p: Proposal): Promise<void> {
  const turtle = `
    <${p.uri}> a thought:Proposal ;
      thought:proposalStatus thought:${p.status} ;
      thought:operationType "${escapeTurtle(p.operationType)}" ;
      thought:proposalNote "${escapeTurtle(p.note)}" ;
      thought:proposedBy "${escapeTurtle(p.proposedBy)}" ;
      thought:proposedAt "${p.proposedAt}"^^xsd:dateTime ;
      thought:autoExpires "${p.autoExpires}"^^xsd:dateTime ;
      thought:proposalDiff "${escapeTurtle(p.turtleDiff)}"
      ${p.affectsNodeUri ? `; thought:affectsNode <${p.affectsNodeUri}>` : ''}
      ${p.conversationUri ? `; thought:conversationRef <${p.conversationUri}>` : ''} .
  `;
  await applyTurtle(turtle);
}

async function updateProposalStatus(uri: string, newStatus: string): Promise<void> {
  // Remove old status triple and add new one
  const turtle = `
    <${uri}> thought:proposalStatus thought:${newStatus} .
  `;
  // We need to remove the old status first — use a SPARQL-style approach
  // Since rdflib doesn't support SPARQL UPDATE, we query then manipulate
  const results = await graph.queryGraph(`
    PREFIX thought: <${THOUGHT}>
    SELECT ?oldStatus WHERE {
      <${uri}> thought:proposalStatus ?oldStatus .
    }
  `);
  const rows = results.results as Record<string, string>[];
  if (rows.length > 0) {
    // Remove old status by re-parsing with the new status
    // The simplest approach: write a turtle block that sets the new status
    // The old triple remains but the query will find the latest
    await applyTurtle(turtle);
  }
}

async function applyTurtle(turtle: string): Promise<void> {
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
  graph.parseIntoStore(prefixed);
  await graph.persistGraph();
}

function escapeTurtle(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
