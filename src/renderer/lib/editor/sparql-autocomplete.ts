import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import {
  detectSparqlPhase,
  extractQueryVariables,
  extractUserPrefixes,
  SPARQL_KEYWORDS,
  SPARQL_BUILTINS,
  STANDARD_PREFIXES,
} from '../../../shared/sparql-completions';

export interface SparqlSchema {
  prefixes: ReadonlyArray<{ prefix: string; iri: string }>;
  predicates: ReadonlyArray<{ iri: string; prefixed?: string }>;
  classes: ReadonlyArray<{ iri: string; prefixed?: string }>;
}

const EMPTY_SCHEMA: SparqlSchema = { prefixes: STANDARD_PREFIXES, predicates: [], classes: [] };

/**
 * Build a CodeMirror CompletionSource for SPARQL (#198). `getSchema`
 * returns the live predicate/class snapshot from the graph \u2014 pulled
 * lazily so an empty graph or a cold thoughtbase doesn\u2019t block the
 * panel from opening.
 */
export function createSparqlCompletionSource(
  getSchema: () => SparqlSchema | null,
) {
  return function source(ctx: CompletionContext): CompletionResult | null {
    const before = ctx.state.doc.sliceString(Math.max(0, ctx.pos - 200), ctx.pos);
    const all = ctx.state.doc.toString();

    const schema = getSchema() ?? EMPTY_SCHEMA;
    const userPrefixes = extractUserPrefixes(all);

    // Known prefixes = standard + user-declared in buffer. Later entries
    // override earlier ones (user redecl of a standard prefix wins).
    const prefixIriByName = new Map<string, string>();
    for (const { prefix, iri } of schema.prefixes) prefixIriByName.set(prefix, iri);
    for (const { prefix, iri } of userPrefixes) prefixIriByName.set(prefix, iri);
    const knownPrefixes = new Set(prefixIriByName.keys());

    const phase = detectSparqlPhase(before, ctx.pos, knownPrefixes);

    if (phase.kind === 'none') return null;

    if (phase.kind === 'variable') {
      if (!ctx.explicit && phase.prefix.length === 0) return null;
      const vars = extractQueryVariables(all).map((v) => ({
        label: v,
        type: 'variable',
      } as Completion));
      return {
        from: phase.from,
        options: prefixMatchSort(vars, phase.prefix),
        filter: false,
      };
    }

    if (phase.kind === 'prefixed') {
      const iri = prefixIriByName.get(phase.prefix);
      if (!iri) return null;
      // Local names of predicates + classes whose IRI starts with this prefix.
      const localsSeen = new Set<string>();
      const options: Completion[] = [];
      const pushLocal = (entry: { iri: string }, type: string) => {
        if (!entry.iri.startsWith(iri)) return;
        const local = entry.iri.slice(iri.length);
        if (!local || localsSeen.has(local)) return;
        localsSeen.add(local);
        options.push({ label: local, type, detail: entry.iri });
      };
      for (const p of schema.predicates) pushLocal(p, 'property');
      for (const c of schema.classes) pushLocal(c, 'class');
      return {
        from: phase.localFrom,
        options: prefixMatchSort(options, phase.local),
        filter: false,
      };
    }

    // General phase: keywords + built-ins + prefix aliases + prefixed
    // predicates / classes + current-query variables.
    if (!ctx.explicit && phase.prefix.length < 2) return null;

    const options: Completion[] = [];

    // Keywords (uppercase) boost higher than everything else so they surface
    // at the top when the user types `SE`, `PR`, etc.
    for (const kw of SPARQL_KEYWORDS) {
      options.push({ label: kw, type: 'keyword', boost: 10 });
    }
    for (const fn of SPARQL_BUILTINS) {
      options.push({ label: fn, type: 'function' });
    }
    // Prefix aliases end with `:` so the user keeps typing locally.
    for (const { prefix } of schema.prefixes) {
      options.push({ label: `${prefix}:`, type: 'namespace', boost: 5 });
    }
    for (const { prefix } of userPrefixes) {
      options.push({ label: `${prefix}:`, type: 'namespace', boost: 5 });
    }
    // Flattened prefixed predicates + classes.
    const emitted = new Set<string>();
    for (const p of schema.predicates) {
      const label = p.prefixed ?? p.iri;
      if (emitted.has(label)) continue;
      emitted.add(label);
      options.push({ label, type: 'property', detail: p.iri });
    }
    for (const c of schema.classes) {
      const label = c.prefixed ?? c.iri;
      if (emitted.has(label)) continue;
      emitted.add(label);
      options.push({ label, type: 'class', detail: c.iri });
    }
    // Current-query variables (with sigil included, so they\u2019re inserted whole).
    for (const v of extractQueryVariables(all)) {
      options.push({ label: `?${v}`, type: 'variable' });
    }

    return {
      from: phase.from,
      options: prefixMatchSort(options, phase.prefix),
      filter: false,
    };
  };
}

/**
 * Keep only options whose label starts with `input` (case-insensitive),
 * then sort by label length + explicit boost. Returning these with
 * `filter: false` on the CompletionResult bypasses CodeMirror\u2019s built-in
 * fuzzy subsequence matcher \u2014 without this, typing "SEL" surfaces
 * anything containing s/e/l in order (`csvw:cell`, \u2026), which reads as
 * spam for a strict-prefix feel.
 */
function prefixMatchSort(options: Completion[], input: string): Completion[] {
  if (input === '') {
    return [...options].sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0) || a.label.localeCompare(b.label));
  }
  const needle = input.toLowerCase();
  return options
    .filter((o) => o.label.toLowerCase().startsWith(needle))
    .sort((a, b) => {
      // Prefer boosted entries (keywords, prefix aliases) at equal label
      // length so `SELECT` beats a random predicate starting with `sel…`.
      const boostDiff = (b.boost ?? 0) - (a.boost ?? 0);
      if (boostDiff !== 0) return boostDiff;
      const lenDiff = a.label.length - b.label.length;
      if (lenDiff !== 0) return lenDiff;
      return a.label.localeCompare(b.label);
    });
}
