// Proposal persistence + serialization for the approval engine. Owns the graph
// writes that store/query/update proposals and the Turtle-application primitive
// they share. Split out of `approval.ts` (#1083) so policy/orchestration stays
// focused; the apply/rollback handlers live in `apply-dispatch.ts`.

import * as $rdf from 'rdflib';
import * as graph from '../graph/index';
import type { ProjectContext } from '../project-context-types';
import { escapeTurtleLiteral } from './turtle';
import type { Proposal, ProposalPayload } from './proposal-types';

export const THOUGHT = 'https://minerva.dev/ontology/thought#';

export function proposalUri(): string {
  return `${THOUGHT}proposal/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Serialization ──────────────────────────────────────────────────────────

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

export function parsePayloads(json: string | undefined): ProposalPayload[] {
  if (!json) {
    // This can be a real proposal-with-zero-payloads or a graph that was
    // written before #418. Returning [] silently was masking the bug Dave
    // hit ("approve succeeded but no notes appeared") — log loudly so the
    // dev console shows it next time.
    console.warn('[approval] proposal has no payloadJson — returning empty payload list');
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    // Throwing here is correct: a proposal whose payload JSON is corrupt
    // should NOT silently approve as a no-op — the user clicked Approve
    // expecting something to land. Surface the error to the panel.
    throw new Error(
      `Proposal payload JSON failed to parse (${e instanceof Error ? e.message : String(e)}). ` +
      `Length: ${json.length}; head: ${JSON.stringify(json.slice(0, 120))}`,
      { cause: e },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Proposal payload JSON is not an array (got ${typeof parsed}).`);
  }
  return parsed as ProposalPayload[];
}

/** Split the GROUP_CONCAT result for affectsNode URIs back into a list.
 *  Separator matches the SPARQL GROUP_CONCAT call below (). */
function splitAffectsNodes(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(String.fromCharCode(0x1f)).filter(Boolean);
}

function proposalFromRow(row: Record<string, string>): Proposal {
  // proposal/operationType/note/proposedBy/proposedAt/autoExpires are required
  // (non-OPTIONAL) bindings in the listProposals query.
  return {
    uri: row.proposal!,
    status: row.status as Proposal['status'],
    operationType: row.operationType!,
    payloads: parsePayloads(row.payloadJson),
    note: row.note!,
    affectsNodeUris: splitAffectsNodes(row.affectsNodes),
    conversationUri: row.conversation,
    proposedBy: row.proposedBy!,
    proposedAt: row.proposedAt!,
    autoExpires: row.autoExpires!,
  };
}

// ── Queries ────────────────────────────────────────────────────────────────

/**
 * List proposals, optionally filtered by status.
 */
export async function listProposals(ctx: ProjectContext, status?: string): Promise<Proposal[]> {
  const statusFilter = status
    ? `?proposal thought:proposalStatus thought:${status} .`
    : '';

  const results = await graph.queryGraph(ctx, `
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

  return (results.results as Record<string, string>[]).map(row => proposalFromRow(row));
}

/**
 * Get a single proposal by URI.
 */
export async function getProposal(ctx: ProjectContext, uri: string): Promise<Proposal | null> {
  const results = await graph.queryGraph(ctx, `
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
  const firstRow = rows[0]!; // non-empty checked above
  const affectsNodeUris = Array.from(
    new Set(rows.map(row => row.affectsNode).filter((u): u is string => Boolean(u))),
  );
  // status/operationType/note/proposedBy/proposedAt/autoExpires/payloadJson are
  // required (non-OPTIONAL) bindings in the query.
  return {
    uri,
    status: firstRow.status as Proposal['status'],
    operationType: firstRow.operationType!,
    payloads: parsePayloads(firstRow.payloadJson),
    note: firstRow.note!,
    affectsNodeUris,
    conversationUri: firstRow.conversation,
    proposedBy: firstRow.proposedBy!,
    proposedAt: firstRow.proposedAt!,
    autoExpires: firstRow.autoExpires!,
  };
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function writeProposalToGraph(ctx: ProjectContext, p: Proposal): Promise<void> {
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
      thought:operationType "${escapeTurtleLiteral(p.operationType)}" ;
      thought:proposalNote "${escapeTurtleLiteral(p.note)}" ;
      thought:proposedBy "${escapeTurtleLiteral(p.proposedBy)}" ;
      thought:proposedAt "${p.proposedAt}"^^xsd:dateTime ;
      thought:autoExpires "${p.autoExpires}"^^xsd:dateTime ;
      thought:payloadJson "${escapeTurtleLiteral(payloadJson)}"
      ${affectsNodeTriples}
      ${p.conversationUri ? `; thought:conversationRef <${p.conversationUri}>` : ''} .
  `;
  await applyTurtle(ctx, turtle);
}

export async function updateProposalStatus(ctx: ProjectContext, uri: string, newStatus: string): Promise<void> {
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

export async function applyTurtle(ctx: ProjectContext, turtle: string): Promise<void> {
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
  return m ? m[1]! : turtle; // capture group present when the regex matches
}
