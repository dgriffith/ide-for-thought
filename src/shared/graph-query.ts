/**
 * The result of running a SPARQL query against the knowledge graph — the
 * `graph:query` IPC surface and main's `queryGraph` (#2363).
 *
 * A malformed or failing query is an EXPECTED outcome, not an exceptional
 * one: the user typed it into the Query panel, a ` ```sparql ` block, a
 * compute cell or an LLM tool call, and the UI renders the parser's message
 * inline. So it is the `{ ok: false; error }` arm of a discriminated union —
 * the same shape as `tables:query` — and **the call itself does not reject
 * for it**. Branch on `ok`. The call DOES reject for a genuine failure, e.g.
 * "no project open" (CLAUDE.md → IPC error handling, rules 1–3).
 *
 * This replaces `{ results, columns, error? }`, where every caller had to
 * remember that a truthy `results` might sit beside an error.
 *
 * `results` stays `unknown[]`: rows are `Record<variable, lexical value>`,
 * and each caller narrows them to the projection its own query selects.
 */
export type GraphQueryResult =
  | { ok: true; results: unknown[]; columns: string[] }
  | { ok: false; error: string };

/** The success arm without its discriminant — what {@link unwrapGraphQuery} returns. */
export interface GraphQueryRows {
  results: unknown[];
  columns: string[];
}

/** A query the app itself authored failed — see {@link unwrapGraphQuery}. */
export class GraphQueryError extends Error {
  constructor(message: string) {
    super(`SPARQL query failed: ${message}`);
    this.name = 'GraphQueryError';
  }
}

/**
 * Rows of a query whose failure is a BUG rather than an expected outcome —
 * fixed SPARQL the app wrote itself (a panel's listing query, an indexer's
 * lookup). Throws {@link GraphQueryError} on the `ok: false` arm so the
 * failure surfaces instead of reading as "no rows".
 *
 * Don't use it for a query a user wrote: render that `error` inline instead.
 */
export function unwrapGraphQuery(r: GraphQueryResult): GraphQueryRows {
  if (!r.ok) throw new GraphQueryError(r.error);
  return { results: r.results, columns: r.columns };
}
