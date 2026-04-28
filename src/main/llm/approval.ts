import * as $rdf from 'rdflib';
import * as graph from '../graph/index';
import * as notebaseFs from '../notebase/fs';
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

/**
 * One side-effect a proposal applies to the thoughtbase. The approval
 * engine dispatches by `kind` at apply time; the user sees the whole
 * bundle as one proposal in the diff view and approves / rejects
 * atomically (#418).
 *
 * Five kinds defined; only `graph-triples` and `note` are wired to a
 * dispatcher today. The other three are reserved for the Research
 * tools that will need them (#415 wants `source`, #414 wants
 * `excerpt` for cited passages, the metacognitive cluster wants
 * `saved-query` for "watch this" queries). Apply attempts on an
 * un-wired kind throw `NotImplementedError` so the type stays
 * accurate without forcing the runtime cost up front.
 */
export type ProposalPayload =
  | {
      kind: 'graph-triples';
      /** Turtle to merge into the project store. Standard prefixes
       *  are auto-injected (same as the legacy single-payload path). */
      turtle: string;
      /** Subjects this turtle introduces. The proposal aggregates
       *  these onto `thought:affectsNode` triples so the trust-
       *  integrity stock query can pin LLM-attributed components to
       *  their approval. */
      affectsNodeUris: string[];
    }
  | {
      kind: 'note';
      /** Project-relative path. On collision, suffixed -2/-3/...; the
       *  resolved path is recorded on the proposal post-apply. */
      relativePath: string;
      content: string;
      /** Optional convenience: emit a single triple linking some
       *  existing node to the new note. Same effect as a separate
       *  `graph-triples` payload but co-located with the note. */
      backlink?: { fromUri: string; predicate: string };
    }
  | {
      kind: 'source';
      sourceId: string;
      metaTtl: string;
      bodyMd?: string;
      original?: { mimeType: string; bytes: Uint8Array };
    }
  | {
      kind: 'excerpt';
      excerptId: string;
      excerptTtl: string;
    }
  | {
      kind: 'saved-query';
      scope: 'project' | 'global';
      name: string;
      description: string;
      query: string;
      language: 'sparql' | 'sql';
      group?: string | null;
    };

export interface ProposedWrite {
  /** Drives approval-tier policy lookup. */
  operationType: OperationType;
  /** Side effects to apply, in order. Triples-last is the convention
   *  callers should follow; rollback assumes file-system payloads
   *  ran before triples (so a triples-parse failure can undo only
   *  file-system effects). */
  payloads: ProposalPayload[];
  /** Human-readable single-line bundle summary for the proposals UI. */
  note: string;
  conversationUri?: string;
  proposedBy: string;
  expiryDays?: number;
}

export interface Proposal {
  uri: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  operationType: string;
  payloads: ProposalPayload[];
  note: string;
  /** Aggregated across every payload: every URI in graph-triples'
   *  affectsNodeUris plus the resolved note URI of any `note`
   *  payload. Surfaced so the trust-integrity stock query can join
   *  the LLM-attributed components back to this proposal. */
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

/** Aggregate every URI a bundle introduces. graph-triples carry their
 *  own list; `note` payloads are translated to the note's IRI. */
function collectAffectsNodes(ctx: ProjectContext, payloads: ProposalPayload[]): string[] {
  const out = new Set<string>();
  for (const p of payloads) {
    if (p.kind === 'graph-triples') {
      for (const u of p.affectsNodeUris) out.add(u);
    } else if (p.kind === 'note') {
      const uri = graph.noteUriFor(ctx, p.relativePath);
      if (uri) out.add(uri);
    }
  }
  return [...out];
}

/**
 * Submit a proposed bundle. Based on the operation's approval tier:
 * - requires_approval: persists a pending Proposal, returns it.
 * - notify_only: applies the bundle immediately, persists an approved
 *   Proposal for audit.
 * - autonomous: applies the bundle immediately, no proposal record.
 */
export async function proposeWrite(ctx: ProjectContext, write: ProposedWrite): Promise<Proposal | null> {
  const tier = getApprovalTier(write.operationType);
  const now = new Date().toISOString();
  const expiryDate = new Date(Date.now() + (write.expiryDays ?? 7) * 86400000).toISOString();

  if (tier === 'autonomous') {
    await applyBundle(ctx, write.payloads);
    return null;
  }

  const uri = proposalUri();
  const affectsNodeUris = collectAffectsNodes(ctx, write.payloads);
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
export async function approveProposal(ctx: ProjectContext, uri: string): Promise<boolean> {
  const proposal = await getProposal(ctx, uri);
  if (!proposal || proposal.status !== 'pending') return false;

  await applyBundle(ctx, proposal.payloads);
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
    SELECT ?proposal ?status ?operationType ?note ?proposedBy ?proposedAt ?autoExpires ?payloadJson
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
      ?proposal thought:payloadJson ?payloadJson .
      ${statusFilter}
      OPTIONAL { ?proposal thought:affectsNode ?affectsNode }
      OPTIONAL { ?proposal thought:conversationRef ?conversation }
    }
    GROUP BY ?proposal ?status ?operationType ?note ?proposedBy ?proposedAt ?autoExpires ?payloadJson ?conversation
    ORDER BY DESC(?proposedAt)
  `);

  return (results.results as Record<string, string>[]).map(r => proposalFromRow(r));
}

/**
 * Get a single proposal by URI.
 */
export async function getProposal(ctx: ProjectContext, uri: string): Promise<Proposal | null> {
  const results = await graph.queryGraph(ctx, `
    PREFIX thought: <${THOUGHT}>
    SELECT ?status ?operationType ?note ?proposedBy ?proposedAt ?autoExpires ?payloadJson ?affectsNode ?conversation WHERE {
      <${uri}> a thought:Proposal .
      <${uri}> thought:proposalStatus ?statusNode .
      BIND(REPLACE(STR(?statusNode), "${THOUGHT}", "") AS ?status)
      <${uri}> thought:operationType ?operationType .
      <${uri}> thought:proposalNote ?note .
      <${uri}> thought:proposedBy ?proposedBy .
      <${uri}> thought:proposedAt ?proposedAt .
      <${uri}> thought:autoExpires ?autoExpires .
      <${uri}> thought:payloadJson ?payloadJson .
      OPTIONAL { <${uri}> thought:affectsNode ?affectsNode }
      OPTIONAL { <${uri}> thought:conversationRef ?conversation }
    }
  `);

  const rows = results.results as Record<string, string>[];
  if (rows.length === 0) return null;
  const r = rows[0];
  const affectsNodeUris = Array.from(
    new Set(rows.map(row => row.affectsNode).filter((u): u is string => Boolean(u))),
  );
  return {
    uri,
    status: r.status as Proposal['status'],
    operationType: r.operationType,
    payloads: parsePayloads(r.payloadJson),
    note: r.note,
    affectsNodeUris,
    conversationUri: r.conversation,
    proposedBy: r.proposedBy,
    proposedAt: r.proposedAt,
    autoExpires: r.autoExpires,
  };
}

function proposalFromRow(r: Record<string, string>): Proposal {
  return {
    uri: r.proposal,
    status: r.status as Proposal['status'],
    operationType: r.operationType,
    payloads: parsePayloads(r.payloadJson),
    note: r.note,
    affectsNodeUris: splitAffectsNodes(r.affectsNodes),
    conversationUri: r.conversation,
    proposedBy: r.proposedBy,
    proposedAt: r.proposedAt,
    autoExpires: r.autoExpires,
  };
}

function parsePayloads(json: string | undefined): ProposalPayload[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed as ProposalPayload[];
  } catch {
    return [];
  }
}

/** Split the GROUP_CONCAT result for affectsNode URIs back into a list.
 *  Separator matches the SPARQL GROUP_CONCAT call above (). */
function splitAffectsNodes(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(String.fromCharCode(0x1f)).filter(Boolean);
}

// ── Apply path ─────────────────────────────────────────────────────────────

/**
 * Per-payload undo state. `dispatch` populates this as each payload
 * lands; on failure of a later payload we walk it in reverse.
 */
interface AppliedRecord {
  kind: ProposalPayload['kind'];
  /** Resolved data the rollback needs (note path, source id, query
   *  filePath, etc). */
  rollbackData: unknown;
}

async function applyBundle(ctx: ProjectContext, payloads: ProposalPayload[]): Promise<void> {
  // Apply file-system payloads first, triples last. Lets a triples
  // parse failure roll back FS effects without needing an rdflib
  // snapshot.
  const ordered = [
    ...payloads.filter((p) => p.kind !== 'graph-triples'),
    ...payloads.filter((p) => p.kind === 'graph-triples'),
  ];

  const applied: AppliedRecord[] = [];
  try {
    for (const p of ordered) {
      const rollbackData = await dispatchApply(ctx, p);
      applied.push({ kind: p.kind, rollbackData });
    }
  } catch (err) {
    // Reverse-order rollback. Best-effort — log but don't mask the
    // original error.
    for (const a of [...applied].reverse()) {
      try { await dispatchRollback(ctx, a); }
      catch (rollbackErr) { console.warn(`[approval] rollback of ${a.kind} failed:`, rollbackErr); }
    }
    throw err;
  }
}

async function dispatchApply(ctx: ProjectContext, p: ProposalPayload): Promise<unknown> {
  switch (p.kind) {
    case 'graph-triples': {
      await applyTurtle(ctx, p.turtle);
      return null;
    }
    case 'note': {
      const finalPath = await resolveCollidingPath(ctx.rootPath, p.relativePath);
      await notebaseFs.createFile(ctx.rootPath, finalPath);
      await notebaseFs.writeFile(ctx.rootPath, finalPath, p.content);
      await graph.indexNote(ctx, finalPath, p.content);
      if (p.backlink) {
        const noteUri = graph.noteUriFor(ctx, finalPath);
        if (noteUri) {
          await applyTurtle(
            ctx,
            `<${p.backlink.fromUri}> <${p.backlink.predicate}> <${noteUri}> .`,
          );
        }
      }
      return { resolvedPath: finalPath };
    }
    case 'source':
    case 'excerpt':
    case 'saved-query':
      throw new Error(
        `Approval payload kind "${p.kind}" not yet wired (#418 ships graph-triples + note; later kinds land as needed).`,
      );
  }
}

async function dispatchRollback(ctx: ProjectContext, a: AppliedRecord): Promise<void> {
  switch (a.kind) {
    case 'graph-triples':
      // Triples ran last by construction — nothing after them to
      // undo. Triples rollback would require an rdflib snapshot;
      // skipped per #418's "triples-last" convention.
      return;
    case 'note': {
      const data = a.rollbackData as { resolvedPath: string };
      try { await notebaseFs.deleteFile(ctx.rootPath, data.resolvedPath); }
      catch { /* file may already be gone */ }
      graph.removeNote(ctx, data.resolvedPath);
      return;
    }
    case 'source':
    case 'excerpt':
    case 'saved-query':
      // Never reached today — apply throws before recording an
      // applied entry for these kinds.
      return;
  }
}

/** Apply-time path dedup. Mirrors `resolveDropName` in drop-import. */
async function resolveCollidingPath(rootPath: string, relativePath: string): Promise<string> {
  const path = await import('node:path');
  const fs = await import('node:fs/promises');
  const dir = path.dirname(relativePath);
  const ext = path.extname(relativePath);
  const stem = path.basename(relativePath, ext);
  let candidate = relativePath;
  let suffix = 2;
  while (true) {
    try {
      await fs.access(path.join(rootPath, candidate));
      // exists → try next
      candidate = dir === '.'
        ? `${stem}-${suffix}${ext}`
        : `${dir}/${stem}-${suffix}${ext}`;
      suffix++;
      if (suffix > 99) throw new Error(`resolveCollidingPath: 99 collisions on ${relativePath}`);
    } catch (err) {
      // ENOENT — slot is free
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
      throw err;
    }
  }
}

// ── Internal Helpers ───────────────────────────────────────────────────────

async function writeProposalToGraph(ctx: ProjectContext, p: Proposal): Promise<void> {
  const affectsNodeTriples = p.affectsNodeUris
    .map(u => `; thought:affectsNode <${u}>`)
    .join('\n      ');
  // Payloads are stored as JSON in a single literal so the proposal
  // is self-contained; restoring requires no additional triple
  // tracking. Larger payloads (note content, source bytes) go inline
  // — fine for typical Research-tool output, would need re-thinking
  // if proposal sizes blow up.
  const payloadJson = serializePayloadsForStorage(p.payloads);
  const turtle = `
    <${p.uri}> a thought:Proposal ;
      thought:proposalStatus thought:${p.status} ;
      thought:operationType "${escapeTurtle(p.operationType)}" ;
      thought:proposalNote "${escapeTurtle(p.note)}" ;
      thought:proposedBy "${escapeTurtle(p.proposedBy)}" ;
      thought:proposedAt "${p.proposedAt}"^^xsd:dateTime ;
      thought:autoExpires "${p.autoExpires}"^^xsd:dateTime ;
      thought:payloadJson "${escapeTurtle(payloadJson)}"
      ${affectsNodeTriples}
      ${p.conversationUri ? `; thought:conversationRef <${p.conversationUri}>` : ''} .
  `;
  await applyTurtle(ctx, turtle);
}

/** JSON-serialisable form. Drops Uint8Array bytes from `source`
 *  payloads — restoring those needs a different store (#418's MVP
 *  doesn't wire `source`, so this is a placeholder). */
function serializePayloadsForStorage(payloads: ProposalPayload[]): string {
  return JSON.stringify(payloads.map((p) => {
    if (p.kind === 'source' && p.original) {
      return { ...p, original: { ...p.original, bytes: '<elided>' } };
    }
    return p;
  }));
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
  const cleaned = stripTurtleCodeFence(turtle);
  const prefixed = `
    @prefix thought: <${THOUGHT}> .
    @prefix minerva: <https://minerva.dev/ontology#> .
    @prefix dc: <http://purl.org/dc/terms/> .
    @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    @prefix prov: <http://www.w3.org/ns/prov#> .
    ${cleaned}
  `;
  // Pre-flight parse into a throwaway store. graph.parseIntoStore
  // swallows parse errors with a console.error (it's the right call
  // for normal indexing — one bad note shouldn't poison the rest),
  // but the approval engine MUST surface them so a malformed
  // proposal triggers rollback rather than silently no-oping.
  const probe = $rdf.graph();
  $rdf.parse(prefixed, probe, 'urn:x-minerva:approval-validate', 'text/turtle');

  // Approval-engine writes are the *only* in-LLM-context writes that
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

/**
 * LLMs frequently emit Turtle wrapped in a markdown code fence —
 * ```turtle\n<turtle>\n``` — even when the prompt says "no code fence."
 * rdflib refuses to parse the fence as Turtle. Strip a single leading
 * ```<lang>\n and a single trailing \n``` before parsing. Any internal
 * backticks (e.g. inside string literals) are left alone.
 *
 * Returns the input unchanged when no fence is detected.
 */
export function stripTurtleCodeFence(turtle: string): string {
  // Match opening fence at first non-whitespace position; capture body up to
  // the matching closing fence at end of string (allowing trailing whitespace).
  const m = /^\s*```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(turtle);
  return m ? m[1] : turtle;
}
