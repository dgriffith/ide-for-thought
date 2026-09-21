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
  getAliasMap, getAliasEntries, aliasesForNote, getAllFrontmatterKeys, noteUriFor, headingsFor,
  findNotesCitingSource, findNotesQuotingExcerpt, findNotesLinkingToAnchor, allNotePaths,
  injectSparqlPrefixes, schemaForCompletion, queryGraph,
  listTags, notesByTagPrefix, notesByTag, sourcesByTag, listAllSources, allTags,
  outgoingLinks, findDerivedNoteForCell, findNotesLinkingTo, backlinks, findExternalInboundLinks, noteTitle, sourceTitle,
  getSourceDetail, getReadingQueueSourceIds, sourcesByReadStatus, citationsForNote, getExcerptSource,
} from './queries';
export type { AliasEntry, SchemaEntry, GraphSchema, ReadingQueueView } from './queries';
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

import { withTrustedContext, rethrowIfTrustGuard } from './write-guard';

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
    aliasMap: new Map(),
    aliasesPerNote: new Map(),
    indexedNotePaths: new Set(),
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
  const { store, rootPath, ontologyStatements } = state;

  const graphPath = path.join(rootPath, '.minerva', 'graph.ttl');
  // Trusted (#2231): this is serialization bookkeeping, not content. It strips
  // the ontology triples, serializes, and puts them straight back — no user or
  // LLM data changes, and the store ends byte-identical to how it started.
  // Saying so explicitly matters because persistGraph IS called from LLM
  // context: `proposal-persistence.ts` calls it right AFTER its own
  // withTrustedContext block closes, and two of the LLM apply paths
  // (`propose-note.ts`, `conversation.ts`) call it directly. Before the guard
  // moved to the store chokepoint those removeMatches/add pairs were invisible
  // to it; now they'd be flagged as a bypass, which would be a false positive.
  withTrustedContext(() => {
    for (const st of ontologyStatements) {
      store.removeMatches(st.subject, st.predicate, st.object);
    }
  });
  const turtle = serializeGraph(ctx);
  withTrustedContext(() => {
    for (const st of ontologyStatements) {
      store.add(st.subject, st.predicate, st.object, st.graph);
    }
  });
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

export async function exportGraph(ctx: ProjectContext, destPath: string): Promise<void> {
  const state = getState(ctx);
  if (!state) return;
  await persistGraph(ctx);
  const turtle = serializeGraph(ctx);
  await fs.writeFile(destPath, turtle, 'utf-8');
}
