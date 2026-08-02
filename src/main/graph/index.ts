import * as $rdf from 'rdflib';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import * as uriHelpers from './uri-helpers';

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
export { getNoteTypedProperties, getTypeInstances } from './note-properties';
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

// ── LLM Write Guard (#671) ────────────────────────────────────────────────
// Extracted into ./write-guard.ts so it can be unit-tested in isolation. The
// public enter/exit/is helpers are re-exported here so existing
// `graph.enterLLMContext()` call sites (approval.ts, auto-link/auto-tag, ipc)
// are unchanged; the indexers (./indexers) call `checkLLMWriteGuard` directly.
export {
  enterLLMContext,
  exitLLMContext,
  isInLLMContext,
  withLLMContext,
  enterTrustedContext,
  exitTrustedContext,
} from './write-guard';
import { checkLLMWriteGuard } from './write-guard';

// ── Project config (persisted in .minerva/config.json) ─────────────────────

interface ProjectConfig {
  baseUri: string;
}

function configPath(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'config.json');
}

function readConfig(rootPath: string): ProjectConfig | null {
  try {
    return JSON.parse(fsSync.readFileSync(configPath(rootPath), 'utf-8')) as ProjectConfig;
  } catch { return null; }
}

function writeConfig(rootPath: string, config: ProjectConfig): void {
  fsSync.writeFileSync(configPath(rootPath), JSON.stringify(config, null, 2), 'utf-8');
}

function resolveBaseUri(rootPath: string): string {
  const existing = readConfig(rootPath);
  if (existing?.baseUri) return existing.baseUri;
  const coined = uriHelpers.coinBaseUri(rootPath);
  writeConfig(rootPath, { baseUri: coined });
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
    headingsPerNote: new Map(),
    aliasMap: new Map(),
    aliasesPerNote: new Map(),
    indexedNotePaths: new Set(),
    frontmatterKeysPerNote: new Map(),
    neighborhoodCache: new Map(),
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
  } catch {
    // No persisted graph yet, start fresh
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
  // Strip ontology triples before serializing — they're re-loaded fresh
  // from the embedded resource on startup, so persisting them would
  // cause duplication on the next load.
  for (const st of ontologyStatements) {
    store.removeMatches(st.subject, st.predicate, st.object);
  }
  const turtle = serializeGraph(ctx);
  for (const st of ontologyStatements) {
    store.add(st.subject, st.predicate, st.object, st.graph);
  }
  await fs.writeFile(graphPath, turtle, 'utf-8');
}

/** Parse a Turtle string and add its triples to the store. Used by the approval engine. */
export function parseIntoStore(ctx: ProjectContext, turtle: string): void {
  checkLLMWriteGuard('parseIntoStore');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  try {
    $rdf.parse(turtle, state.store, 'urn:x-minerva:void', 'text/turtle');
  } catch (e) {
    console.error('[minerva] Failed to parse turtle into store:', e instanceof Error ? e.message : e);
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
  checkLLMWriteGuard('removeMatchingTriples');
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
