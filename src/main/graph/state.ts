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
import { performance } from 'node:perf_hooks';
import * as uriHelpers from './uri-helpers';
import type { LinkType } from '../../shared/link-types';
import type { NeighborhoodResult } from '../../shared/types';
import type { ProjectContext } from '../project-context-types';
import { createProjectStore } from '../project-store';

// ── Comunica engine (process-wide; stateless across projects) ────────────────

let engine: QueryEngine | null = null;

/** Lazily construct the process-wide Comunica engine and return it. */
export function getEngine(): QueryEngine {
  if (!engine) engine = new QueryEngine();
  return engine;
}

// ── SPARQL/RDF plumbing ──────────────────────────────────────────────────────

/** A full N3 rebuild slower than this (ms) trips a dev-log warning. The rebuild
 *  is O(n) in triple count and runs synchronously on the main thread, so this
 *  makes the latent cost cliff observable in the dev console before it bites at
 *  100k+ triples (#1088). Not fatal, and silent in production — it's a
 *  diagnostic, not a runtime guard. Deliberately generous so it stays quiet at
 *  the current ~5–10k-triple working size. */
const N3_REBUILD_WARN_MS = 75;

/** Build an N3.Store from rdflib's IndexedFormula for Comunica to query.
 *  O(n) in `s.statements.length`; see `N3_REBUILD_WARN_MS`. */
export function buildN3Store(s: $rdf.IndexedFormula): N3.Store {
  const started = performance.now();
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

  const elapsedMs = performance.now() - started;
  if (elapsedMs > N3_REBUILD_WARN_MS && process.env.NODE_ENV !== 'production') {
    // A write-then-query pattern (e.g. auto-link backlink checks on save)
    // invalidates the cache and pays this rebuild repeatedly — watch for it if
    // this fires. Fixes to consider when it does: incremental on-write N3
    // maintenance, or moving the rebuild off the main thread (#1088).
    console.warn(
      `[graph] N3 store rebuild took ${elapsedMs.toFixed(0)}ms for ${s.statements.length} triples ` +
      `(O(n), synchronous on the main thread) — see #1088.`,
    );
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
  /**
   * Memoized `neighborhood()` results keyed by `path\0depth\0cap` (perf #1113).
   * The graph/citations panels re-run a neighborhood BFS on every note switch
   * via a reactive `$effect`, and a build hops up to `cap` nodes × (outgoing +
   * backlink) predicate fans — so re-selecting a note used to redo the whole
   * traversal. A small LRU (bounded in `neighborhood()`) keeps back-and-forth
   * navigation off the BFS. Cleared wholesale by `invalidate()` on every write,
   * the same coarse always-correct invalidation `n3Cache` uses: any triple
   * change can alter some note's link neighborhood, so a targeted eviction would
   * be both fiddly and easy to get subtly wrong.
   */
  neighborhoodCache: Map<string, NeighborhoodResult>;
}

// One GraphState per open project, keyed by rootPath. The entire graph
// read/write path — rdflib IndexedFormula mutation, `invalidate()`, and the
// on-demand N3 rebuild in `queryGraph` — runs synchronously on the Electron
// main thread, one IPC handler at a time. That single-threaded serialization is
// precisely what lets this store and the mutable IndexedFormula stay lock-free:
// no two writes, and no write racing the rebuild, can ever interleave. A write
// nulls `n3Cache` and the very next query rebuilds it before anyone reads it. If
// any of this ever moves off the main thread (e.g. the O(n) rebuild into a
// worker, #1088), that invariant breaks and real synchronization becomes
// necessary. The rdflib IndexedFormula holds no OS handle, so there's no dispose
// hook — teardown just drops the state (#1085).
const store = createProjectStore<GraphState>();

export function getState(ctx: ProjectContext): GraphState | null {
  return store.get(ctx);
}

/** Register a freshly-built state for a project. */
export function setState(ctx: ProjectContext, state: GraphState): void {
  store.set(ctx, state);
}

/** Tear down a project's graph state. Called by ProjectContext on last release. */
export function deleteState(ctx: ProjectContext): void {
  void store.dispose(ctx);
}

export function invalidate(state: GraphState): void {
  // NOTE (#1110): this no longer nulls `n3Cache`. The N3 mirror is now
  // maintained incrementally by `instrumentStoreMirror` — every rdflib
  // add/removeMatches applies the same delta to the live mirror — so a write no
  // longer discards a mirror that may hold 100k triples for the next query to
  // rebuild from scratch. The only path that must drop the mirror is a
  // wholesale store swap (`indexAllNotes`), which calls `resetN3Mirror`.
  // Any triple change can alter some note's neighborhood; drop the memo (#1113).
  state.neighborhoodCache.clear();
}

// ── Incremental N3 mirror maintenance (#1110) ────────────────────────────────
//
// rdflib's mutable IndexedFormula is the source of truth; the N3.Store mirror
// (`state.n3Cache`) is what Comunica reads. Rather than null-and-full-rebuild on
// every write (O(all triples) on the next query), we wrap the store's two
// mutation methods so each write applies the equivalent delta to the live
// mirror — O(changed triples). The mirror flattens every named graph into the
// default graph, exactly as `buildN3Store` does, so query semantics are
// unchanged. Correctness on removal leans on rdflib itself as the reference
// count: a flattened quad is dropped only when rdflib no longer asserts that
// (s,p,o) in ANY graph — provably identical to a from-scratch `buildN3Store`.

/** Belt-and-suspenders: force a fresh full rebuild after this many incremental
 *  mirror mutations, so any unforeseen drift self-heals within a bounded window
 *  (#1110 asks for a periodic/fallback rebuild). Generous — the amortized cost
 *  of one O(n) rebuild per N writes is negligible next to N incremental deltas. */
const N3_PERIODIC_REBUILD_EVERY = 1000;

interface MirrorMarker {
  /** Set once per store instance so we never double-wrap. */
  __minervaMirrored?: boolean;
  /** Incremental mutations applied since the last full build (periodic reset). */
  __minervaN3Writes?: number;
}

/** The two rdflib mutation methods + the read used to snapshot removals, viewed
 *  with loose params so we can wrap them without fighting rdflib's Quad_* types. */
interface MutableStore {
  add(s: RdflibTermLike, p: RdflibTermLike, o: RdflibTermLike, g?: unknown): unknown;
  removeMatches(s?: unknown, p?: unknown, o?: unknown, g?: unknown): unknown;
  statementsMatching(s?: unknown, p?: unknown, o?: unknown, g?: unknown): $rdf.Statement[];
}

/** Null the mirror so the next `queryGraph` rebuilds it from scratch. Use on a
 *  wholesale store swap or as the periodic/fallback rebuild. */
export function resetN3Mirror(state: GraphState): void {
  state.n3Cache = null;
  (state.store as unknown as MirrorMarker).__minervaN3Writes = 0;
}

function mirrorAdd(state: GraphState, s: RdflibTermLike, p: RdflibTermLike, o: RdflibTermLike): void {
  const n3 = state.n3Cache;
  if (!n3) return;
  const df = N3.DataFactory;
  try {
    const subject = convertTerm(s, df);
    const predicate = convertTerm(p, df) as N3.NamedNode | null;
    const object = convertTerm(o, df);
    // Same guard + default-graph flattening as buildN3Store; addQuad is
    // idempotent, so re-asserting an existing triple is a no-op.
    if (subject && predicate && object) {
      n3.addQuad(subject as N3.Quad_Subject, predicate, object as N3.Quad_Object, df.defaultGraph());
    }
  } catch { /* mirror buildN3Store's skip-malformed resilience */ }
}

function mirrorRemove(state: GraphState, removed: $rdf.Statement[]): void {
  const n3 = state.n3Cache;
  if (!n3) return;
  const df = N3.DataFactory;
  for (const st of removed) {
    try {
      // Drop the flattened quad ONLY when rdflib no longer asserts this (s,p,o)
      // in any graph — otherwise a sibling named graph still needs it (rdflib is
      // the reference count). `undefined` graph = match across all graphs.
      if (state.store.statementsMatching(st.subject, st.predicate, st.object, undefined).length > 0) continue;
      const subject = convertTerm(st.subject, df);
      const predicate = convertTerm(st.predicate, df) as N3.NamedNode | null;
      const object = convertTerm(st.object, df);
      if (!subject || !predicate || !object) continue;
      // Remove the ACTUAL stored quad(s), located by value via getQuads, rather
      // than a freshly-reconstructed term — literal datatype/canonicalization
      // can differ just enough that removeQuad(reconstructed) misses. getQuads
      // matches by term value; removeQuad(quad) mutates synchronously (unlike
      // removeMatches, which returns a stream and wouldn't mutate in place).
      for (const q of n3.getQuads(subject, predicate, object, df.defaultGraph())) {
        n3.removeQuad(q);
      }
    } catch { /* skip malformed, same as buildN3Store */ }
  }
}

/**
 * Wrap `state.store`'s `add` / `removeMatches` so every rdflib mutation applies
 * the matching delta to the live N3 mirror. Idempotent per store instance; call
 * after each `state.store = $rdf.graph()`. When `n3Cache` is null (cold, or
 * during a bulk load before the first query) mirroring is skipped and the next
 * query rebuilds from scratch — so this adds only a cheap null-check per write
 * on the cold path.
 */
export function instrumentStoreMirror(state: GraphState): void {
  const store = state.store;
  const marker = store as unknown as MirrorMarker;
  if (marker.__minervaMirrored) return;
  marker.__minervaMirrored = true;
  marker.__minervaN3Writes = 0;

  // rdflib's method signatures use Quad_* subtypes we don't satisfy at this
  // boundary; view the store through a loose interface so the wrapping stays
  // type-clean without `any`.
  const m = store as unknown as MutableStore;
  const origAdd = m.add.bind(m);
  const origRemoveMatches = m.removeMatches.bind(m);
  const matchAny = m.statementsMatching.bind(m);

  function bumpAndMaybeRebuild(): void {
    if (!state.n3Cache) return;
    marker.__minervaN3Writes = (marker.__minervaN3Writes ?? 0) + 1;
    if (marker.__minervaN3Writes >= N3_PERIODIC_REBUILD_EVERY) resetN3Mirror(state);
  }

  m.add = function (s: RdflibTermLike, p: RdflibTermLike, o: RdflibTermLike, g?: unknown) {
    const ret = origAdd(s, p, o, g);
    mirrorAdd(state, s, p, o);
    bumpAndMaybeRebuild();
    return ret;
  };

  m.removeMatches = function (s?: unknown, p?: unknown, o?: unknown, g?: unknown) {
    if (!state.n3Cache) return origRemoveMatches(s, p, o, g);
    // Snapshot (.slice) the statements about to be removed BEFORE the rdflib
    // removal: rdflib's statementsMatching can return a live reference to its
    // internal array, which origRemoveMatches then splices in place — so without
    // the copy `removed` would be empty by the time we reconcile the mirror.
    const removed = matchAny(s ?? undefined, p ?? undefined, o ?? undefined, g ?? undefined).slice();
    const ret = origRemoveMatches(s, p, o, g);
    mirrorRemove(state, removed);
    bumpAndMaybeRebuild();
    return ret;
  };
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
