/**
 * SPARQL plumbing (#1838 — split by family out of `queries.ts`).
 *
 * The query engine's own surface: prefix injection, the schema the editor's
 * completion reads, and `queryGraph` itself. Distinct from every other family
 * here — those answer specific questions about notes, and this one runs
 * whatever the user asked.
 *
 * Read-only, reaches only `../state`, re-exported by `queries.ts`.
 */
import type { ProjectContext } from '../../project-context-types';
import {
  getState, getEngine, ensureN3Cache,
  RDF,
  STANDARD_PREFIXES,
} from '../state';
import { unwrapGraphQuery, type GraphQueryResult, type GraphQueryRows } from '../../../shared/graph-query';

/**
 * One declaration in a SPARQL prologue, anchored at `lastIndex` (sticky):
 * leading whitespace and `#` comments, then `BASE <iri>` or
 * `PREFIX name: <iri>` (keyword in any case; `name` may be empty).
 */
const PROLOGUE_DECL = /(?:\s|#[^\n]*(?:\n|$))*(?:(base)\s*<[^>\s]*>|(prefix)(?:\s+|(?=:))([^\s:<>#]*):\s*<[^>\s]*>)/iy;

/**
 * The prefix names `sparql` itself declares, exactly as spelled (prefix
 * names are case-sensitive: `PREFIX DC:` does not declare `dc`). Only the
 * PROLOGUE is read — the one place a SPARQL query can declare a prefix — so a
 * `# PREFIX skos: …` comment, a string literal or an IRI that merely mentions
 * one is not mistaken for a declaration (#2388).
 */
function declaredSparqlPrefixes(sparql: string): Set<string> {
  const names = new Set<string>();
  PROLOGUE_DECL.lastIndex = 0;
  for (let m = PROLOGUE_DECL.exec(sparql); m; m = PROLOGUE_DECL.exec(sparql)) {
    if (m[2]) names.add(m[3] ?? '');
  }
  return names;
}

export function injectSparqlPrefixes(sparql: string): string {
  // Only inject prefixes the user hasn't already declared: a duplicate
  // declaration is an evaluator error. The keyword is case-insensitive and
  // spacing varies (`Prefix  x:`), which a naive includes("PREFIX x:") missed.
  //
  // What counts as "declared" is the prologue, not a text search (#2388): the
  // old `\bprefix\s+x\s*:` test also matched a comment or a string that
  // mentioned one, and a query whose `skos:` injection was skipped that way
  // still PARSED — Comunica silently pre-binds a few common prefixes to its
  // own namespaces (its `skos:` is the 2008 draft, not 2004/02/skos/core) —
  // and quietly matched nothing.
  const declared = declaredSparqlPrefixes(sparql);
  const lines: string[] = [];
  for (const [prefix, iri] of STANDARD_PREFIXES) {
    if (!declared.has(prefix)) {
      lines.push(`PREFIX ${prefix}: <${iri}>`);
    }
  }
  return lines.length > 0 ? lines.join('\n') + '\n' + sparql : sparql;
}

export interface SchemaEntry {
  iri: string;
  /** Prefixed form when a known prefix covers the IRI (e.g. "minerva:hasTag"). */
  prefixed?: string;
}

export interface GraphSchema {
  /** Standard prefixes the query path auto-injects. */
  prefixes: Array<{ prefix: string; iri: string }>;
  /** Distinct predicate IRIs in the live graph. */
  predicates: SchemaEntry[];
  /** Distinct class IRIs (objects of `rdf:type`) in the live graph. */
  classes: SchemaEntry[];
}

/**
 * Snapshot of the live graph’s predicates + classes for autocomplete (#198).
 * Sorted alphabetically by prefixed form when available, otherwise by full
 * IRI. Safe to call often — cheap walk over the store.
 */
export function schemaForCompletion(ctx: ProjectContext): GraphSchema {
  const prefixes = STANDARD_PREFIXES.map(([prefix, iri]) => ({ prefix, iri }));
  const state = getState(ctx);
  if (!state) return { prefixes, predicates: [], classes: [] };
  const { store } = state;

  const rdfTypeIri = RDF('type').value;
  const predicateIris = new Set<string>();
  const classIris = new Set<string>();

  for (const st of store.statements) {
    predicateIris.add(st.predicate.value);
    if (st.predicate.value === rdfTypeIri && st.object.termType === 'NamedNode') {
      classIris.add(st.object.value);
    }
  }

  function toEntry(iri: string): SchemaEntry {
    for (const { prefix, iri: base } of prefixes) {
      if (iri.startsWith(base)) {
        return { iri, prefixed: `${prefix}:${iri.slice(base.length)}` };
      }
    }
    return { iri };
  }

  const sortKey = (e: SchemaEntry) => (e.prefixed ?? e.iri).toLowerCase();

  return {
    prefixes,
    predicates: [...predicateIris].map(toEntry).sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    classes: [...classIris].map(toEntry).sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
  };
}

/**
 * Comunica's read-only flag (`KeysQueryOperation.readOnly`). Spelled as the
 * raw key rather than importing `@comunica/context-entries`, which is not a
 * direct dependency; `tests/main/llm/prompt-injection/` pins that it still
 * takes effect (the refusal names Comunica's own error, not ours), so a
 * Comunica upgrade that renames it fails a test.
 */
const COMUNICA_READ_ONLY = '@comunica/bus-query-operation:readOnly';

export const READ_ONLY_ERROR =
  'SPARQL Update is not supported here: the knowledge graph is read-only to queries. ' +
  'Notes and proposals are the only way to change it.';

/**
 * Run SPARQL the USER wrote (Query panel, ` ```sparql ` block, compute cell,
 * LLM tool). A parse/evaluation failure is an expected outcome and comes back
 * as `{ ok: false, error }` rather than a throw — see {@link GraphQueryResult}.
 * For SPARQL the app authored itself, use {@link queryGraphRows}.
 *
 * READ-ONLY (#2373). SPARQL Update is refused (`{ ok: false }`), both by
 * Comunica's own read-only flag and by the `void` result check below — the
 * store may only change through the indexers and the approval engine, and
 * the N3 mirror this runs against is a derived cache that an update would
 * silently desynchronise from the rdflib store. Federation (`SERVICE`,
 * `LOAD`, dereferencing a `FROM <http://…>`) makes no network request: the
 * `query-sparql-rdfjs` build ships no HTTP actor, so the dereference bus has
 * nothing to answer it. `tests/main/llm/prompt-injection/` pins both with a
 * local listener that counts hits.
 */
export async function queryGraph(
  ctx: ProjectContext,
  sparql: string,
): Promise<GraphQueryResult> {
  const state = getState(ctx);
  if (!state) return { ok: true, results: [], columns: [] };
  const engine = await getEngine();
  try {
    // Build the mirror if cold, yielding so a large rebuild doesn't jank the
    // main thread (#1115). Warm queries return the live mirror with no yield.
    const n3Store = await ensureN3Cache(state);
    const prefixed = injectSparqlPrefixes(sparql);

    // Use the full query() API (not queryBindings) so we can read the result
    // metadata: the SELECT projection — in order, including variables that end
    // up unbound in every row. Deriving columns from the bindings alone would
    // silently drop an always-unbound column.
    const result = await engine.query(prefixed, {
      sources: [n3Store],
      [COMUNICA_READ_ONLY]: true,
    });
    if (result.resultType === 'void') {
      // SPARQL Update (INSERT / DELETE / LOAD / CLEAR / …). Refused outright
      // (#2373): this entry point answers questions, and the store is only
      // ever mutated through the indexers and the approval engine. It used to
      // answer "no rows" — the update was simply never executed — which told a
      // caller (including a prompt-injected model) that its write succeeded.
      return { ok: false, error: READ_ONLY_ERROR };
    }
    if (result.resultType !== 'bindings') {
      return { ok: true, results: [], columns: [] };
    }
    const metadata = await result.metadata();
    // Comunica's runtime shape for `variables` has drifted from its types: some
    // versions expose `RDF.Variable[]` (the element IS the variable), others
    // `{ variable: RDF.Variable }[]`. Handle both so the column list is robust.
    const vars = metadata.variables as unknown as Array<{ value?: string; variable?: { value: string } }>;
    let columns = vars.map((v) => v.variable?.value ?? v.value ?? '').filter(Boolean);

    const bindingsStream = await result.execute();
    const bindings = await bindingsStream.toArray();
    const results = bindings.map((binding) => {
      const obj: Record<string, string> = {};
      for (const [variable, term] of binding) {
        obj[variable.value] = term.value;
      }
      return obj;
    });

    if (columns.length === 0) {
      // Fallback (e.g. metadata unavailable): union of keys across all rows.
      const seen = new Set<string>();
      for (const row of results) for (const k of Object.keys(row)) seen.add(k);
      columns = [...seen];
    }

    return { ok: true, results, columns };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Run SPARQL the APP authored — a fixed lookup whose failure is a bug, not a
 * user's typo. Throws `GraphQueryError` instead of answering "no rows", so a
 * broken internal query surfaces rather than silently emptying whatever reads
 * it (CLAUDE.md → IPC error handling, rule 1). Same rows as {@link queryGraph}.
 */
export async function queryGraphRows(ctx: ProjectContext, sparql: string): Promise<GraphQueryRows> {
  return unwrapGraphQuery(await queryGraph(ctx, sparql));
}

