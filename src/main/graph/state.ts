/**
 * Shared graph foundation (#671, increment 2).
 *
 * The leaf module of the graph package: per-project `GraphState`, the
 * namespaces, the Comunica/RDF query plumbing, and the `state`-taking URI
 * helpers that BOTH the read/query layer (`./queries`) and the
 * indexer/lifecycle layer (`./index`) depend on.
 *
 * IMPORTANT: this module must import NOTHING from `./index` or `./queries`.
 * It is the bottom of the dependency graph so the package stays acyclic.
 */

import * as $rdf from 'rdflib';
import { QueryEngine } from '@comunica/query-sparql-rdfjs';
import * as N3 from 'n3';
import * as uriHelpers from './uri-helpers';
import type { LinkType } from '../../shared/link-types';
import type { ProjectContext } from '../project-context-types';

// ── Comunica engine (process-wide; stateless across projects) ────────────────

let engine: QueryEngine | null = null;

/** Lazily construct the process-wide Comunica engine and return it. */
export function getEngine(): QueryEngine {
  if (!engine) engine = new QueryEngine();
  return engine;
}

// ── SPARQL/RDF plumbing ──────────────────────────────────────────────────────

/** Build an N3.Store from rdflib's IndexedFormula for Comunica to query */
export function buildN3Store(s: $rdf.IndexedFormula): N3.Store {
  const n3Store = new N3.Store();
  const df = N3.DataFactory;

  for (const st of s.statements) {
    try {
      const subject = convertTerm(st.subject, df);
      const predicate = convertTerm(st.predicate, df) as N3.NamedNode;
      const object = convertTerm(st.object, df);
      if (subject && predicate && object) {
        // n3.addQuad's overloads insist on (Quad_Subject, Quad_Predicate,
        // Quad_Object, ...) but our convertTerm produces N3.Term —
        // structurally compatible for the runtime check it does.
        n3Store.addQuad(subject as N3.Quad_Subject, predicate, object as N3.Quad_Object, df.defaultGraph());
      }
    } catch { /* skip malformed triples */ }
  }

  return n3Store;
}

// rdflib's term shape isn't fully typed at this boundary — accept anything
// shaped like { termType, value, datatype? } and translate to N3.
export interface RdflibTermLike {
  termType?: string;
  value?: string;
  datatype?: { value: string };
  language?: string;
}

export function convertTerm(term: RdflibTermLike | null | undefined, df: typeof N3.DataFactory): N3.Term | null {
  if (!term || !term.termType || term.value == null) return null;
  switch (term.termType) {
    case 'NamedNode': return df.namedNode(term.value);
    case 'BlankNode': return df.blankNode(term.value);
    case 'Literal':
      if (term.datatype) return df.literal(term.value, df.namedNode(term.datatype.value));
      if (term.language) return df.literal(term.value, term.language);
      return df.literal(term.value);
    default: return null;
  }
}

// ── Namespaces ──────────────────────────────────────────────────────────────

export const MINERVA = $rdf.Namespace('https://minerva.dev/ontology#');
export const DC      = $rdf.Namespace('http://purl.org/dc/terms/');
export const RDF     = $rdf.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
export const RDFS    = $rdf.Namespace('http://www.w3.org/2000/01/rdf-schema#');
export const XSD     = $rdf.Namespace('http://www.w3.org/2001/XMLSchema#');
export const CSVW    = $rdf.Namespace('http://www.w3.org/ns/csvw#');
export const OWL     = $rdf.Namespace('http://www.w3.org/2002/07/owl#');
export const BIBO    = $rdf.Namespace('http://purl.org/ontology/bibo/');
export const SCHEMA  = $rdf.Namespace('http://schema.org/');
export const PROV    = $rdf.Namespace('http://www.w3.org/ns/prov#');
export const THOUGHT = $rdf.Namespace('https://minerva.dev/ontology/thought#');

export const STANDARD_PREFIXES: [string, string][] = [
  ['minerva', 'https://minerva.dev/ontology#'],
  ['thought', 'https://minerva.dev/ontology/thought#'],
  ['dc', 'http://purl.org/dc/terms/'],
  ['rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
  ['rdfs', 'http://www.w3.org/2000/01/rdf-schema#'],
  ['xsd', 'http://www.w3.org/2001/XMLSchema#'],
  ['csvw', 'http://www.w3.org/ns/csvw#'],
  ['owl', 'http://www.w3.org/2002/07/owl#'],
  ['prov', 'http://www.w3.org/ns/prov#'],
  ['bibo', 'http://purl.org/ontology/bibo/'],
  ['schema', 'http://schema.org/'],
];

// ── Per-project state (#333) ────────────────────────────────────────────────
//
// Each open thoughtbase has one GraphState regardless of how many windows
// show it. Lookup is keyed by ctx.rootPath. Internal helpers take a
// `state` parameter where they need any of the project-scoped fields;
// public exports take `ctx: ProjectContext` and resolve state from it.

export interface HeadingSnapshot {
  slug: string;
  text: string;
  level: number;
}

export interface GraphState {
  rootPath: string;
  baseUri: string;
  store: $rdf.IndexedFormula;
  /** N3.Store mirror cached for Comunica; rebuilt on demand by queryGraph.
   *  rdflib is the mutable source of truth; this is a derived RDF/JS mirror the
   *  SPARQL engine can read, invalidated (nulled) on every write and fully
   *  rebuilt on the next query. Why two stores — and why rdflib isn't retired
   *  for n3-only — is recorded in docs/architecture/rdf-and-dom-libraries.md
   *  (#987 / #1013). */
  n3Cache: N3.Store | null;
  /** Cached parsed ontology triples; reloaded fresh on init, stripped before persist. */
  ontologyStatements: $rdf.Statement[];
  /** Heading snapshot per note for the rename-detection heuristic. */
  headingsPerNote: Map<string, HeadingSnapshot[]>;
  /**
   * Frontmatter alias name → relativePath (#469). Lower-cased keys for
   * case-insensitive resolution. Title- and filename-stem matches win
   * over aliases, so an alias that collides with an existing canonical
   * name is dropped from this map by `rebuildAliasMap`.
   */
  aliasMap: Map<string, string>;
  /** Per-note alias snapshot — the strings the indexer last accepted from
   *  each note's frontmatter. Lets `indexNote` patch `aliasMap` without
   *  re-walking every note in the project. */
  aliasesPerNote: Map<string, string[]>;
  /** Every relativePath the indexer has touched, used to drop alias
   *  keys that collide with a real file's stem or basename (#469). A
   *  superset of `aliasesPerNote.keys()` — notes without aliases still
   *  count for canonical-name conflicts. */
  indexedNotePaths: Set<string>;
  /** Frontmatter keys present on each indexed note. Powers the
   *  Properties panel's project-wide key autocomplete (#488) — the
   *  graph already extracts frontmatter on every index, so capturing
   *  the bare key list is essentially free. Kept as a string[] per
   *  note (rather than a flat global Set) so removeNote can shrink
   *  the union without scanning every note. */
  frontmatterKeysPerNote: Map<string, string[]>;
}

const states = new Map<string, GraphState>();

export function getState(ctx: ProjectContext): GraphState | null {
  return states.get(ctx.rootPath) ?? null;
}

/** Register a freshly-built state for a project. */
export function setState(ctx: ProjectContext, state: GraphState): void {
  states.set(ctx.rootPath, state);
}

/** Tear down a project's graph state. Called by ProjectContext on last release. */
export function deleteState(ctx: ProjectContext): void {
  states.delete(ctx.rootPath);
}

export function invalidate(state: GraphState): void {
  state.n3Cache = null;
}

// ── URI helpers (delegate to uri-helpers module) ────────────────────────────

export function noteUri(state: GraphState, relativePath: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.noteUri(state.baseUri, relativePath));
}

export function tagUri(state: GraphState, tagName: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.tagUri(state.baseUri, tagName));
}

export function folderUri(state: GraphState, relativePath: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.folderUri(state.baseUri, relativePath));
}

export function sourceUri(state: GraphState, sourceId: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.sourceUri(state.baseUri, sourceId));
}

export function excerptUri(state: GraphState, excerptId: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.excerptUri(state.baseUri, excerptId));
}

export function tableUri(state: GraphState, tableName: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.tableUri(state.baseUri, tableName));
}

export function projectUri(state: GraphState): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.projectUri(state.baseUri));
}

export function linkPredicate(lt: LinkType) {
  return lt.predicateNamespace === 'thought' ? THOUGHT(lt.predicate) : MINERVA(lt.predicate);
}

/** Strip an IRI fragment (`#…`) if present — use to find the note subject a link points at. */
export function stripFragment(uri: string): string {
  const idx = uri.indexOf('#');
  return idx < 0 ? uri : uri.slice(0, idx);
}

export function dateLit(iso: string): $rdf.Literal {
  return $rdf.lit(iso, undefined, XSD('dateTime'));
}
