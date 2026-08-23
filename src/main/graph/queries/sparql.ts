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

export function injectSparqlPrefixes(sparql: string): string {
  // Only inject prefixes the user hasn't already declared. SPARQL's
  // PREFIX keyword is case-insensitive and allows varied whitespace,
  // so a naive includes("PREFIX x:") test misses `Prefix x:` and
  // `PREFIX  x :` — both legal, both would produce duplicate-decl
  // errors from the evaluator if we blindly injected on top.
  const lines: string[] = [];
  for (const [prefix, iri] of STANDARD_PREFIXES) {
    const re = new RegExp(`\\bprefix\\s+${prefix}\\s*:`, 'i');
    if (!re.test(sparql)) {
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

export async function queryGraph(
  ctx: ProjectContext,
  sparql: string,
): Promise<{ results: unknown[]; columns: string[]; error?: string }> {
  const state = getState(ctx);
  if (!state) return { results: [], columns: [] };
  const engine = getEngine();
  try {
    // Build the mirror if cold, yielding so a large rebuild doesn't jank the
    // main thread (#1115). Warm queries return the live mirror with no yield.
    const n3Store = await ensureN3Cache(state);
    const prefixed = injectSparqlPrefixes(sparql);

    // Use the full query() API (not queryBindings) so we can read the result
    // metadata: the SELECT projection — in order, including variables that end
    // up unbound in every row. Deriving columns from the bindings alone would
    // silently drop an always-unbound column.
    const result = await engine.query(prefixed, { sources: [n3Store] });
    if (result.resultType !== 'bindings') {
      return { results: [], columns: [] };
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

    return { results, columns };
  } catch (e) {
    return { results: [], columns: [], error: String(e) };
  }
}

