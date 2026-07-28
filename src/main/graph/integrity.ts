/**
 * Trust-Principle integrity auditor (#1101).
 *
 * The single source of truth for the "unreviewed LLM writes" integrity query
 * that CLAUDE.md documents: find every `thought:Component` node attributed to an
 * LLM (`thought:extractedBy` containing "llm") that lacks an *approved*
 * `thought:Proposal` affecting it — i.e. a component that reached the graph
 * without passing the approval gate.
 *
 * This is the runtime auditor for the Trust Principle ("the LLM proposes, the
 * human confirms"). It complements the other defence-in-depth layers — the
 * write guard (`checkLLMWriteGuard`), the proposal-survives-reindex snapshot,
 * and the approval-engine contract tests — by checking the *resulting graph
 * state* rather than the code path. Promoting it from a manual dev-run query
 * (Graph ▸ Query) into `findUnreviewedLLMWrites` lets a vitest test gate it on
 * every PR (`tests/main/graph/trust-integrity.test.ts`).
 *
 * Standard prefixes (thought, rdf, rdfs, …) are auto-injected by `queryGraph`,
 * so the query text below carries none.
 */
import type { ProjectContext } from '../project-context-types';
import { queryGraph } from './index';

/**
 * SPARQL: LLM-attributed `thought:Component` nodes with no approved proposal.
 * An empty result set means the Trust Principle holds. Keep this in sync with
 * the copy in CLAUDE.md (this is the canonical, executable version).
 */
export const UNREVIEWED_LLM_WRITES_QUERY = `
SELECT ?component ?label ?extractedBy WHERE {
  ?component rdf:type/rdfs:subClassOf* thought:Component .
  ?component thought:extractedBy ?extractedBy .
  FILTER(CONTAINS(LCASE(STR(?extractedBy)), "llm"))
  OPTIONAL { ?component thought:label ?label }
  FILTER NOT EXISTS {
    ?proposal rdf:type thought:Proposal .
    ?proposal thought:affectsNode ?component .
    ?proposal thought:proposalStatus thought:approved .
  }
}
ORDER BY ?component`;

/** One offending node: an LLM-attributed component with no approved proposal. */
export interface UnreviewedLLMWrite {
  /** Component node URI. */
  component: string;
  /** `thought:label`, when present. */
  label?: string;
  /** The `thought:extractedBy` provenance value that matched "llm". */
  extractedBy: string;
}

/**
 * Run the integrity audit against the live graph. Returns the offending nodes
 * (empty ⇒ the Trust Principle holds). Throws if the query itself errors.
 */
export async function findUnreviewedLLMWrites(ctx: ProjectContext): Promise<UnreviewedLLMWrite[]> {
  const r = await queryGraph(ctx, UNREVIEWED_LLM_WRITES_QUERY);
  if (r.error) throw new Error(`integrity query failed: ${r.error}`);
  return r.results as UnreviewedLLMWrite[];
}
