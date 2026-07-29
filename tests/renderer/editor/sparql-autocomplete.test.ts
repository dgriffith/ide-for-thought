import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import {
  createSparqlCompletionSource,
  type SparqlSchema,
} from '../../../src/renderer/lib/editor/sparql-autocomplete';

/**
 * Representative schema. Prefixes are deliberately minimal (thought + rdf) so
 * option lists are predictable. The predicates/classes include duplicates,
 * an empty-local entry, and an IRI outside the thought namespace to exercise
 * the skip/dedup branches of the prefixed phase.
 */
const SCHEMA: SparqlSchema = {
  prefixes: [
    { prefix: 'thought', iri: 'https://minerva.dev/ontology/thought#' },
    { prefix: 'rdf', iri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' },
  ],
  predicates: [
    { iri: 'https://minerva.dev/ontology/thought#supports', prefixed: 'thought:supports' },
    { iri: 'https://minerva.dev/ontology/thought#supportedBy', prefixed: 'thought:supportedBy' },
    // duplicate IRI -> hits `localsSeen`/`emitted` dedup guards
    { iri: 'https://minerva.dev/ontology/thought#supports', prefixed: 'thought:supports' },
    // outside the thought namespace -> skipped by the prefixed-phase startsWith guard
    { iri: 'http://other.example/name', prefixed: 'other:name' },
  ],
  classes: [
    { iri: 'https://minerva.dev/ontology/thought#Claim', prefixed: 'thought:Claim' },
    // IRI === prefix IRI -> empty local -> skipped in prefixed phase
    { iri: 'https://minerva.dev/ontology/thought#', prefixed: 'thought:' },
    // label collides with a predicate -> hits the general-phase class dedup guard
    { iri: 'https://minerva.dev/ontology/thought#supports', prefixed: 'thought:supports' },
  ],
};

/** Build a CompletionContext at `pos` (default: end of doc) and run the source. */
function run(
  doc: string,
  getSchema: () => SparqlSchema | null,
  opts: { explicit?: boolean; pos?: number } = {},
): CompletionResult | null {
  const pos = opts.pos ?? doc.length;
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  const ctx = new CompletionContext(state, pos, opts.explicit ?? false);
  return createSparqlCompletionSource(getSchema)(ctx);
}

const withSchema = () => SCHEMA;
const labels = (r: CompletionResult | null) => (r?.options ?? []).map((o) => o.label);

describe('createSparqlCompletionSource — variable phase', () => {
  it('returns null on a bare `?` when not explicit', () => {
    const doc = 'SELECT ?foo ?bar WHERE { ?foo ?p ?';
    expect(run(doc, withSchema, { explicit: false })).toBeNull();
  });

  it('lists all buffer variables on a bare `?` when explicit', () => {
    const doc = 'SELECT ?foo ?bar WHERE { ?foo ?p ?';
    const res = run(doc, withSchema, { explicit: true });
    expect(res).not.toBeNull();
    expect(res!.filter).toBe(false);
    // from is the cursor itself (empty prefix) — the `?` is not replaced
    expect(res!.from).toBe(doc.length);
    // sorted alphabetically, sans sigil
    expect(labels(res)).toEqual(['bar', 'foo', 'p']);
    expect(res!.options.every((o) => o.type === 'variable')).toBe(true);
  });

  it('filters variables by the typed prefix even when not explicit', () => {
    const doc = 'SELECT ?foo ?food WHERE { ?f';
    const res = run(doc, withSchema, { explicit: false });
    expect(res).not.toBeNull();
    // prefix length 1 (> 0) so the not-explicit guard does not fire
    expect(labels(res)).toEqual(['f', 'foo', 'food']);
    // `from` steps back over the one typed char
    expect(res!.from).toBe(doc.length - 1);
  });
});

describe('createSparqlCompletionSource — prefixed phase', () => {
  it('lists local names of a known prefix, deduped, skipping foreign/empty locals', () => {
    const doc = 'SELECT * WHERE { ?s thought:';
    const res = run(doc, withSchema);
    expect(res).not.toBeNull();
    expect(res!.filter).toBe(false);
    // Claim (class) + supports/supportedBy (property); `other:name` and the
    // empty-local `thought:` entry are dropped; the duplicate `supports` once.
    expect(labels(res)).toEqual(['Claim', 'supportedBy', 'supports']);
    const byLabel = Object.fromEntries(res!.options.map((o) => [o.label, o]));
    expect(byLabel['Claim'].type).toBe('class');
    expect(byLabel['supports'].type).toBe('property');
    // detail carries the full IRI
    expect(byLabel['supports'].detail).toBe('https://minerva.dev/ontology/thought#supports');
    // from is the start of the local name (right after the colon)
    expect(res!.from).toBe(doc.length);
  });

  it('filters locals by the typed local prefix and sets from to the local start', () => {
    const doc = 'SELECT * WHERE { ?s thought:sup';
    const res = run(doc, withSchema);
    expect(labels(res)).toEqual(['supports', 'supportedBy']);
    expect(res!.from).toBe(doc.length - 'sup'.length);
  });

  it('honors a user PREFIX redeclaration overriding a standard prefix IRI', () => {
    const schema: SparqlSchema = {
      prefixes: [{ prefix: 'rdf', iri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' }],
      predicates: [{ iri: 'http://custom.rdf/type', prefixed: 'rdf:type' }],
      classes: [],
    };
    // Buffer redeclares rdf: to the custom IRI, so the predicate now matches.
    const doc = 'PREFIX rdf: <http://custom.rdf/>\nSELECT * WHERE { ?s rdf:';
    const res = run(doc, () => schema);
    expect(labels(res)).toEqual(['type']);
    expect(res!.options[0].detail).toBe('http://custom.rdf/type');
  });

  it('returns an empty option list for a known prefix with no matching schema terms', () => {
    // getSchema returns null -> EMPTY_SCHEMA (standard prefixes, no predicates).
    // `rdf` is a standard prefix so the phase is `prefixed`, but nothing matches.
    const doc = 'SELECT * WHERE { ?s rdf:';
    const res = run(doc, () => null);
    expect(res).not.toBeNull();
    expect(res!.options).toEqual([]);
  });
});

describe('createSparqlCompletionSource — general phase', () => {
  it('returns null for a single typed char when not explicit', () => {
    expect(run('S', withSchema, { explicit: false })).toBeNull();
  });

  it('surfaces keywords first (boosted) for a >=2 char prefix without explicit', () => {
    const res = run('SEL', withSchema, { explicit: false });
    expect(res).not.toBeNull();
    expect(res!.filter).toBe(false);
    expect(labels(res)).toEqual(['SELECT']);
    expect(res!.options[0].type).toBe('keyword');
    expect(res!.from).toBe(0);
  });

  it('orders equal-boost keywords by length then alphabetically', () => {
    // `AS`, `ASC`, `ASK` are all keywords (boost 10). AS (len 2) leads, then
    // ASC before ASK (localeCompare tiebreak at equal length).
    const res = run('AS', withSchema, { explicit: false });
    expect(labels(res).slice(0, 3)).toEqual(['AS', 'ASC', 'ASK']);
  });

  it('lists namespace aliases, prefixed terms, and the empty-local class in the general phase', () => {
    const res = run('thought', withSchema, { explicit: false });
    const l = labels(res);
    // namespace alias (boost 5) precedes the boost-0 terms
    expect(l[0]).toBe('thought:');
    expect(res!.options[0].type).toBe('namespace');
    expect(l).toContain('thought:supports');
    expect(l).toContain('thought:supportedBy');
    expect(l).toContain('thought:Claim');
    // the empty-local class contributes a second 'thought:' label (a class)
    expect(l.filter((x) => x === 'thought:').length).toBe(2);
    // predicate/class detail carries the IRI
    const claim = res!.options.find((o) => o.label === 'thought:Claim')!;
    expect(claim.type).toBe('class');
    expect(claim.detail).toBe('https://minerva.dev/ontology/thought#Claim');
  });

  it('includes user-declared prefix aliases and current-query variables', () => {
    const doc = 'PREFIX ex: <http://ex.org/>\nSELECT ?x WHERE { ex';
    const res = run(doc, withSchema, { explicit: false });
    const l = labels(res);
    // EXISTS keyword (boost 10) sorts above the user alias `ex:` (boost 5)
    expect(l).toContain('EXISTS');
    expect(l).toContain('ex:');
    expect(l.indexOf('EXISTS')).toBeLessThan(l.indexOf('ex:'));
    const alias = res!.options.find((o) => o.label === 'ex:')!;
    expect(alias.type).toBe('namespace');
  });

  it('surfaces current-query variables (with sigil) in the general phase', () => {
    // Variables enter general options with their `?` sigil, so they only pass
    // prefixMatchSort under an empty prefix (explicit trigger over whitespace).
    const doc = 'SELECT ?myvar WHERE { ?s ?p ?o } ';
    const res = run(doc, withSchema, { explicit: true });
    const varOpt = res!.options.find((o) => o.label === '?myvar');
    expect(varOpt).toBeDefined();
    expect(varOpt!.type).toBe('variable');
  });

  it('returns the full, boost-sorted catalog on an explicit trigger over whitespace', () => {
    // Cursor after a space -> general phase, empty prefix, explicit bypasses guard.
    const doc = 'SELECT ';
    const res = run(doc, withSchema, { explicit: true });
    expect(res).not.toBeNull();
    // empty-input branch of prefixMatchSort: keywords (boost 10) lead
    expect(res!.options[0].boost).toBe(10);
    expect(res!.options[0].type).toBe('keyword');
    // a large flattened catalog is returned
    expect(res!.options.length).toBeGreaterThan(50);
    expect(res!.from).toBe(doc.length);
  });
});
