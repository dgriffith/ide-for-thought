/**
 * Graph read / query layer (#671, increment 2).
 *
 * Pure read functions over the per-project `GraphState`: alias / frontmatter
 * lookups, SPARQL execution, tag / source / link / citation queries. None of
 * these mutate the store or go through the LLM write guard.
 *
 * Imports its foundations from `./state` (never from `./index`, to keep the
 * package acyclic). `./index` re-exports this module's public surface so
 * external `import * as graph from './graph/index'` callers are unchanged.
 */

import * as $rdf from 'rdflib';
import type { ProjectContext } from '../project-context-types';
import { LINK_TYPES } from '../../shared/link-types';
import { stripNoteExt } from '../../shared/note-extensions';
import {
  type GraphState, type HeadingSnapshot,
  getState, getEngine, ensureN3Cache,
  MINERVA, RDF, THOUGHT,
  STANDARD_PREFIXES,
  noteUri, sourceUri, excerptUri,
  linkPredicate,
} from './state';

// Tag queries live in `./queries/tags` (#1838). Re-exported here so
// `graph/index` and every `import … from './queries'` caller is unchanged —
// the same facade shape `indexers.ts` uses for `./indexers/*`.
export {
  listTags,
  notesByTagPrefix,
  notesByTag,
  sourcesByTag,
  allTags,
} from './queries/tags';

// Source queries live in `./queries/sources` (#1838), same arrangement.
export {
  listAllSources,
  getSourceDetail,
  getReadingQueueSourceIds,
  sourcesByReadStatus,
  citationsForNote,
  getExcerptSource,
} from './queries/sources';

// `DAY_MS` moved with the reading-queue code that uses it; `llm/approval`
// imports it from here.
export { DAY_MS } from './queries/sources';
export type { ReadingQueueView } from './queries/sources';

// Link queries live in `./queries/links` (#1838), same arrangement.
export {
  noteTitle,
  sourceTitle,
  outgoingLinks,
  findDerivedNoteForCell,
  findNotesLinkingTo,
  backlinks,
  findExternalInboundLinks,
} from './queries/links';

// ── Alias / frontmatter lookups ─────────────────────────────────────────────

/**
 * Snapshot of the live alias map (#469). Returns alias → relativePath
 * pairs as a plain object; the renderer uses it for wiki-link
 * navigation and (eventually) autocomplete. Keys are lower-cased.
 */
export function getAliasMap(ctx: ProjectContext): Record<string, string> {
  const state = getState(ctx);
  if (!state) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of state.aliasMap) out[k] = v;
  return out;
}

/**
 * Entries form of the alias map, preserving original casing (#492).
 * `getAliasMap` lowercases everything for case-insensitive resolution;
 * the wiki-link autocomplete needs the original casing so picking a
 * suggested alias inserts `[[JFK]]` rather than `[[jfk]]`.
 *
 * Same conflict policy as `rebuildAliasMap`:
 *   - Alphabetical-first-writer wins on alias collisions.
 *   - Aliases that lowercase-collide with a real note's path stem or
 *     basename are dropped.
 */
export interface AliasEntry {
  alias: string;
  relativePath: string;
}
/** The frontmatter aliases declared by a single note (#1074) — for pointing the
 *  unlinked-mentions embeddings query at an object's title + aliases. */
export function aliasesForNote(ctx: ProjectContext, relativePath: string): string[] {
  const state = getState(ctx);
  return state?.aliasesPerNote.get(relativePath) ?? [];
}

export function getAliasEntries(ctx: ProjectContext): AliasEntry[] {
  const state = getState(ctx);
  if (!state) return [];
  const claimed = new Set<string>(); // lowercase aliases already taken
  // Drop any alias whose lowercase form collides with a real note's
  // canonical name — matches rebuildAliasMap's second pass.
  const canonicals = new Set<string>();
  for (const path of state.indexedNotePaths) {
    const stem = stripNoteExt(path).toLowerCase();
    canonicals.add(stem);
    const basename = stem.split('/').pop() ?? '';
    if (basename) canonicals.add(basename);
  }
  const out: AliasEntry[] = [];
  const paths = [...state.aliasesPerNote.keys()].sort();
  for (const path of paths) {
    const aliases = state.aliasesPerNote.get(path) ?? [];
    for (const alias of aliases) {
      const key = alias.toLowerCase();
      if (canonicals.has(key)) continue;
      if (claimed.has(key)) continue;
      claimed.add(key);
      out.push({ alias, relativePath: path });
    }
  }
  return out;
}

/**
 * Deduped, alphabetically-sorted list of every frontmatter key
 * currently in use across the project. Powers the Properties panel's
 * Add-Property autocomplete (#488). Empty when the project has no
 * graph state yet.
 */
export function getAllFrontmatterKeys(ctx: ProjectContext): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const seen = new Set<string>();
  for (const keys of state.frontmatterKeysPerNote.values()) {
    for (const k of keys) seen.add(k);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * The IRI Minerva uses to identify the note at `relativePath` in the
 * graph for project `ctx`. Exposed so callers outside graph/index.ts
 * (notably the conversation module, which writes thought:contextNote
 * triples) can write a real IRI instead of stuffing a relative path
 * into an angle-bracket slot. Returns null when the project has no
 * graph state yet — caller should treat that as "no triple to write".
 */
export function noteUriFor(ctx: ProjectContext, relativePath: string): string | null {
  const state = getState(ctx);
  if (!state) return null;
  return noteUri(state, relativePath).value;
}

/** Return headings present in the last indexNote call for `relativePath`, or []. */
export function headingsFor(ctx: ProjectContext, relativePath: string): HeadingSnapshot[] {
  const state = getState(ctx);
  return state?.headingsPerNote.get(relativePath) ?? [];
}

// ── Citation / anchor link lookups ──────────────────────────────────────────

/** Notes with a `thought:cites` edge to the given source URI. */
export function findNotesCitingSource(ctx: ProjectContext, sourceId: string): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const target = sourceUri(state, sourceId);
  return collectNotePathsWithPredicate(state, THOUGHT('cites'), target);
}

/** Notes with a `thought:quotes` edge to the given excerpt URI. */
export function findNotesQuotingExcerpt(ctx: ProjectContext, excerptId: string): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const target = excerptUri(state, excerptId);
  return collectNotePathsWithPredicate(state, THOUGHT('quotes'), target);
}

function collectNotePathsWithPredicate(
  state: GraphState,
  predicate: ReturnType<typeof MINERVA>,
  target: $rdf.NamedNode,
): string[] {
  const { store } = state;
  const stmts = store.statementsMatching(undefined, predicate, target);
  const seen = new Set<string>();
  for (const st of stmts) {
    const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
    const p = pathStmts[0]?.object.value;
    if (p && p.endsWith('.md')) seen.add(p);
  }
  return [...seen];
}

/** Relative paths of every note typed `thought:Term` — glossary entries
 *  (#1142). Used to give term nodes a distinct rendering in the neighborhood
 *  graph. Returned as a Set for O(1) membership during graph classification. */
export function termNotePaths(ctx: ProjectContext): Set<string> {
  const state = getState(ctx);
  if (!state) return new Set();
  const { store } = state;
  const paths = new Set<string>();
  for (const st of store.statementsMatching(undefined, RDF('type'), THOUGHT('Term'))) {
    const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
    const p = pathStmts[0]?.object.value;
    if (p && p.endsWith('.md')) paths.add(p);
  }
  return paths;
}

/** All indexed `.md` note paths in the thoughtbase (#215 — cross-note
 *  rules use this to reason about which link shortenings are unambiguous). */
export function allNotePaths(ctx: ProjectContext): string[] {
  const state = getState(ctx);
  if (!state) return [];
  return [...state.indexedNotePaths].filter((p) => p.endsWith('.md'));
}

/** Like findNotesLinkingTo, but scoped to links whose anchor is exactly `slug`. */
export function findNotesLinkingToAnchor(
  ctx: ProjectContext,
  targetRelativePath: string,
  slug: string,
): string[] {
  const state = getState(ctx);
  if (!state) return [];
  return findNotesLinkingToAnchorImpl(state, targetRelativePath, slug);
}

export function findNotesLinkingToAnchorImpl(
  state: GraphState,
  targetRelativePath: string,
  slug: string,
): string[] {
  const { store } = state;
  const exactTarget = `${noteUri(state, targetRelativePath).value}#${slug}`;
  const seen = new Set<string>();
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    const stmts = store.statementsMatching(undefined, linkPredicate(lt), undefined);
    for (const st of stmts) {
      if (st.object.value !== exactTarget) continue;
      const sourceNode = st.subject;
      const pathStmts = store.statementsMatching(sourceNode, MINERVA('relativePath'), undefined);
      const sourcePath = pathStmts[0]?.object.value;
      if (sourcePath && sourcePath.endsWith('.md')) seen.add(sourcePath);
    }
  }
  return [...seen];
}

// ── SPARQL ──────────────────────────────────────────────────────────────────

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
