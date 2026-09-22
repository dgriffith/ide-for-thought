import * as $rdf from 'rdflib';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as uriHelpers from './uri-helpers';
import { readRawProjectConfig, patchRawProjectConfig } from '../config/project-config-store';
import { logger } from '../../shared/logger';

import type { ProjectContext } from '../project-context-types';
import { EMPTY_TYPE_CATALOG } from '../../shared/objects/type-def';

// ── Shared foundation (#671) ─────────────────────────────────────────────────
// Per-project state, namespaces, the SPARQL/RDF plumbing, and the state-taking
// URI helpers live in ./state — the leaf module shared by the indexers
// (./indexers) and the read/query layer (./queries). Imported here; not
// re-exported (external callers use the public read/write API, not GraphState
// internals).
import {
  type GraphState,
  getEngine,
  getState, setState, deleteState, invalidate, instrumentStoreMirror,
} from './state';

// ── Public read API (#671) ───────────────────────────────────────────────────
// The read/query layer lives in ./queries. Re-export its public surface so
// external `import * as graph from './graph/index'` callers are unchanged.
export {
  getAliasMap, getAliasEntries, aliasesForNote, getAllFrontmatterKeys, noteUriFor, excerptUriFor, headingsFor,
  findNotesCitingSource, findNotesQuotingExcerpt, findNotesLinkingToAnchor, allNotePaths,
  injectSparqlPrefixes, schemaForCompletion, queryGraph,
  listTags, notesByTagPrefix, notesByTag, sourcesByTag, listAllSources, allTags,
  outgoingLinks, findDerivedNoteForCell, findNotesLinkingTo, backlinks, findExternalInboundLinks, noteTitle, sourceTitle,
  getSourceDetail, getReadingQueueSourceIds, getReadingQueueCounts, READING_QUEUE_VIEWS,
  sourcesByReadStatus, citationsForNote, getExcerptSource,
} from './queries';
export type { AliasEntry, SchemaEntry, GraphSchema, ReadingQueueView, ReadingQueueCounts } from './queries';
export { getNoteTypedProperties, getTypeInstances, getNoteTypeMap } from './note-properties';
export { neighborhood, expandNode } from './neighborhood';
export type {
  NeighborhoodResult, NeighborhoodNode, NeighborhoodEdge, NeighborhoodOptions, NeighborhoodHop,
} from './neighborhood';

// ── Public write / indexing API (#671) ───────────────────────────────────────
// The write/indexing layer lives in ./indexers. Re-export its public surface so
// external `import * as graph from './graph/index'` callers are unchanged.
// `addOntologyToStore` is imported (used by initGraph below) but not re-exported
// — it's internal-only.
export {
  indexNote, removeNote,
  indexAllNotes, reloadTypeCatalog,
} from './indexers';
export type { HeadingRenameCandidate } from './indexers';
// Per-format indexers extracted from ./indexers (#1624):
export {
  indexCsvTable, unindexCsvTable, unindexAllCsvTables,
  indexMarkdownTable, unindexMarkdownTable, unindexAllNoteTables,
} from './indexers/tables';
export type { CsvTableColumn, CsvTableShape, MarkdownTableShape } from './indexers/tables';
export {
  indexSource, removeSource, parseSourceIdFromPath,
} from './indexers/source';
export {
  indexExcerpt, removeExcerpt, excerptIdsForSource, parseExcerptIdFromPath,
} from './indexers/excerpt';
import { addOntologyToStore } from './indexers';

/** Tear down a project's graph state. Called by ProjectContext on last release. */
export function disposeProject(ctx: ProjectContext): void {
  deleteState(ctx);
}

import { rethrowIfTrustGuard } from './write-guard';

// ── LLM Write Guard (#671, converged onto AsyncLocalStorage in #2053) ──────
// Extracted into ./write-guard.ts so it can be unit-tested in isolation. The
// public with*Context/enter/exit/is helpers are re-exported here for the
// approval engine (apply-dispatch.ts, proposal-persistence.ts) and the LLM
// apply helpers (auto-tag/-link, set/source-properties, conversation IPC).
// The guard itself is applied at the store chokepoint — `instrumentStoreMirror`
// in ./state wraps store.add/removeMatches — so no facade here or in ./indexers
// has to remember to call it (#2231).
export {
  enterLLMContext,
  exitLLMContext,
  isInLLMContext,
  withLLMContext,
  enterTrustedContext,
  exitTrustedContext,
  withTrustedContext,
} from './write-guard';

// ── Project config (persisted in .minerva/config.json) ─────────────────────
// Read/write goes through the shared leaf in ../config/project-config-store
// (#1891) — this module used to have its own reader/writer that replaced the
// whole file with just `{baseUri}`, destroying displayName/publishTargets/etc.

function resolveBaseUri(rootPath: string): string {
  const existing = readRawProjectConfig(rootPath);
  if (typeof existing.baseUri === 'string' && existing.baseUri) return existing.baseUri;
  const coined = uriHelpers.coinBaseUri(rootPath);
  patchRawProjectConfig(rootPath, { baseUri: coined });
  return coined;
}

// ── Init ────────────────────────────────────────────────────────────────────

export async function initGraph(ctx: ProjectContext): Promise<void> {
  const { rootPath } = ctx;
  const metaDir = path.join(rootPath, '.minerva');
  await fs.mkdir(metaDir, { recursive: true });

  // Initialize Comunica engine (process-wide; stateless across projects)
  getEngine();

  const state: GraphState = {
    rootPath,
    baseUri: resolveBaseUri(rootPath),
    store: $rdf.graph(),
    n3Cache: null,
    ontologyStatements: [],
    typeCatalog: EMPTY_TYPE_CATALOG,
  };
  // Wrap the store's mutation methods so the N3 mirror is maintained
  // incrementally for this store's whole life (#1110). n3Cache is null now, so
  // the load below isn't mirrored — the first query rebuilds it from scratch.
  instrumentStoreMirror(state);

  // Load persisted graph if it exists
  const graphPath = path.join(metaDir, 'graph.ttl');
  try {
    const turtle = await fs.readFile(graphPath, 'utf-8');
    $rdf.parse(turtle, state.store, 'urn:x-minerva:void', 'text/turtle');
  } catch (e) {
    // No persisted graph yet, start fresh — but never swallow a tripped guard
    // (#2231). `initGraph` is deliberately NOT wrapped in withTrustedContext:
    // it's project lifecycle, nothing calls it from an LLM path today, and
    // blanket-trusting a bulk load that parses whatever is on disk would be a
    // permanent hole. If it ever DOES run in LLM context we want to hear about
    // it rather than have it pre-approved.
    rethrowIfTrustGuard(e);
  }

  // Load ontology last: addOntologyToStore() strips any matching triples
  // before re-adding, which self-heals graph.ttl files written by older
  // versions that persisted the ontology alongside the user's data.
  addOntologyToStore(state);

  setState(ctx, state);
}

// ── Persistence & Export ────────────────────────────────────────────────────

export async function persistGraph(ctx: ProjectContext): Promise<void> {
  const state = getState(ctx);
  if (!state) return;
  const { rootPath } = state;

  const graphPath = path.join(rootPath, '.minerva', 'graph.ttl');
  // `graph.ttl` holds the user's data, never the bundled ontology — and this
  // serializes a filtered VIEW of the store rather than removing the ontology
  // from it and putting it back (#2209).
  //
  // The old shape was: strip ~1,100 ontology triples, serialize, re-add them.
  // It cost twice over. `removeMatches` bottoms out in a linear scan of
  // `store.statements`, so the strip was O(|ontology| x T) — 326ms at 3,000
  // notes, fully synchronous. Worse, ~2,200 mirror mutations in one call sail
  // past `N3_PERIODIC_REBUILD_EVERY` (1,000) and null `state.n3Cache`, so the
  // next query pays a full cold `buildN3Store`. Measured at 2,000 notes: warm
  // query 2.18ms, post-persist 32.80ms — a 15x regression, caused entirely by
  // bookkeeping that changed nothing.
  //
  // Nothing needs to move. The ontology already lives in its own named graphs
  // (`addOntologyToStore` re-adds each statement with the `st.graph` it was
  // parsed into), so the statements to write are simply the ones NOT in those
  // graphs — and a plain `Formula` holding that filtered array serializes the
  // same way an `IndexedFormula` does.
  //
  // A plain `Formula` rather than a second `$rdf.graph()` on purpose:
  // `IndexedFormula.add` maintains four indices per statement, which at 3,000
  // notes cost more than the strip it was replacing (measured 1.1x — i.e. no
  // win at the scale that matters). `Formula` skips all of it, since this
  // object is written once and read once.
  //
  // Verified byte-identical to the strip-and-restore output at 500/1,000/3,000
  // notes, and 4.1x faster at 3,000 (492ms -> 121ms). It also mutates nothing,
  // which is why the `withTrustedContext` wrapper this used to need (#2231) is
  // gone: there is no store write for the chokepoint guard to see.
  const turtle = serializeUserGraph(ctx);
  await fs.writeFile(graphPath, turtle, 'utf-8');
}

/** Parse a Turtle string and add its triples to the store. Used by the approval engine. */
export function parseIntoStore(ctx: ProjectContext, turtle: string): void {
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  try {
    $rdf.parse(turtle, state.store, 'urn:x-minerva:void', 'text/turtle');
  } catch (e) {
    // The write guard now fires from inside `store.add` (#2231), i.e. inside
    // this try. Swallowing it here would turn "an LLM write bypassed the
    // approval engine" into a logged parse error and nothing else — which is
    // precisely the silence this guard exists to prevent. Malformed Turtle
    // still falls through to the log below.
    rethrowIfTrustGuard(e);
    logger('graph').error('Failed to parse turtle into store:', e instanceof Error ? e.message : e);
  }
}

/**
 * Drop every triple matching `(subject, predicate, *)`. Used by the
 * approval engine to replace single-cardinality predicates like
 * `thought:proposalStatus` so a status change doesn't leave the prior
 * status hanging on the same proposal (#332).
 */
export function removeMatchingTriples(
  ctx: ProjectContext,
  subjectIri: string,
  predicateIri: string,
): void {
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  state.store.removeMatches($rdf.sym(subjectIri), $rdf.sym(predicateIri), undefined);
}

/**
 * Point the in-memory graph state at a new base IRI (#1443 Part B). The caller
 * persists it to config and runs `indexAllNotes`, which regenerates every note/
 * tag/folder IRI from the files under the new base. No-op if the project isn't
 * live. Does NOT rewrite triples in place — the rebuild is the mechanism.
 */
export function setBaseUri(ctx: ProjectContext, baseUri: string): void {
  const state = getState(ctx);
  if (state) state.baseUri = baseUri;
}

export function serializeGraph(ctx: ProjectContext): string {
  const state = getState(ctx);
  if (!state) return '';
  // Pass a dummy base that doesn't match any of our URIs,
  // forcing the serializer to emit all IRIs as absolute.
  return $rdf.serialize(null, state.store, 'urn:x-minerva:void', 'text/turtle') ?? '';
}

/**
 * The user's data alone — what `graph.ttl` stores (#2209).
 *
 * Distinct from `serializeGraph` above, which emits the whole store including
 * the bundled ontology, and is what `exportGraph` wants: the menu's "Export
 * Knowledge Graph" deliberately ships a self-contained file a stranger can
 * read without Minerva's vocabulary to hand (#2233 made that the single
 * behaviour after the menu and the channel disagreed about it). Persisting is
 * the opposite case — the ontology is bundled with the app, so writing it into
 * every project's `graph.ttl` stores a copy that `addOntologyToStore` strips
 * and replaces at load anyway.
 *
 * The split is free because the two already live in different graphs: user
 * triples in the default graph, ontology triples in the named graphs
 * `addOntologyToStore` parsed them into. `$rdf.serialize`'s first argument is
 * the graph to emit.
 */
export function serializeUserGraph(ctx: ProjectContext): string {
  const state = getState(ctx);
  if (!state) return '';

  // Which graphs the ontology occupies is read off the statements themselves
  // rather than hardcoded, so changing the parse base in `addOntologyToStore`
  // can't silently start writing the vocabulary into every project's file.
  const ontologyGraphs = new Set(
    state.ontologyStatements.map((st) => st.graph?.value ?? ''),
  );

  // NOT `$rdf.graph()`: an IndexedFormula maintains four indices per `add`,
  // which at 3,000 notes costs about as much as the strip this replaces. This
  // object is written once and read once, so it needs no indices at all.
  const userOnly = new $rdf.Formula();
  userOnly.statements = state.store.statements.filter(
    (st) => !ontologyGraphs.has(st.graph?.value ?? ''),
  );
  // No prefix bindings to carry across: `store.namespaces` is empty here (the
  // parse paths never populate it), and the serializer derives its own from
  // the statements — which is why the output below is byte-identical to what
  // serializing the real store produced.

  return $rdf.serialize(null, userOnly, 'urn:x-minerva:void', 'text/turtle') ?? '';
}

export async function exportGraph(ctx: ProjectContext, destPath: string): Promise<void> {
  const state = getState(ctx);
  if (!state) return;
  await persistGraph(ctx);
  const turtle = serializeGraph(ctx);
  await fs.writeFile(destPath, turtle, 'utf-8');
}
