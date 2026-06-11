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
import { LINK_TYPES, type LinkType } from '../../shared/link-types';
import type {
  TagInfo, TaggedNote, TaggedSource,
  OutgoingLink, Backlink, SafeDeleteBlocker,
  SourceDetail, SourceMetadata, SourceExcerpt, SourceBacklink, SourceAboutNote,
  SourceReference, ReadStatus,
} from '../../shared/types';
import {
  type GraphState, type HeadingSnapshot,
  getState, getEngine, buildN3Store,
  MINERVA, DC, RDF, BIBO, PROV, THOUGHT,
  STANDARD_PREFIXES,
  noteUri, tagUri, sourceUri, excerptUri,
  linkPredicate, stripFragment,
} from './state';

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
export function getAliasEntries(ctx: ProjectContext): AliasEntry[] {
  const state = getState(ctx);
  if (!state) return [];
  const claimed = new Set<string>(); // lowercase aliases already taken
  // Drop any alias whose lowercase form collides with a real note's
  // canonical name — matches rebuildAliasMap's second pass.
  const canonicals = new Set<string>();
  for (const path of state.indexedNotePaths) {
    const stem = path.replace(/\.md$/i, '').toLowerCase();
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
  const { store } = state;

  try {
    if (!state.n3Cache) state.n3Cache = buildN3Store(store);
    const n3Store = state.n3Cache;
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

// ── Tag queries ─────────────────────────────────────────────────────────────

export function listTags(ctx: ProjectContext): TagInfo[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  // Bucket per tag-name into note vs source counts. A subject is a
  // source when it carries minerva:sourceId; otherwise we treat the
  // hasTag edge as belonging to a note (this matches what notesByTag
  // returns once the rdf:type filter has been applied).
  const buckets = new Map<string, { noteCount: number; sourceCount: number }>();
  const stmts = store.statementsMatching(undefined, MINERVA('hasTag'), undefined);
  for (const st of stmts) {
    const tagNode = st.object;
    const nameStmts = store.statementsMatching(tagNode as $rdf.NamedNode, MINERVA('tagName'), undefined);
    const name = nameStmts[0]?.object.value ?? tagNode.value;
    let bucket = buckets.get(name);
    if (!bucket) {
      bucket = { noteCount: 0, sourceCount: 0 };
      buckets.set(name, bucket);
    }
    const isSource = store.statementsMatching(st.subject, MINERVA('sourceId'), undefined).length > 0;
    if (isSource) bucket.sourceCount++;
    else bucket.noteCount++;
  }

  return [...buckets.entries()]
    .map(([tag, b]) => ({ tag, noteCount: b.noteCount, sourceCount: b.sourceCount }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * Notes with any tag at-or-under `prefix` (#466). Matches the literal
 * `prefix` and any tag that starts with `prefix/…` so clicking a
 * parent row in the tree returns the same set the cumulative count
 * promised. Deduped by relativePath since one note can carry multiple
 * matching tags.
 */
export function notesByTagPrefix(ctx: ProjectContext, prefix: string): TaggedNote[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const seen = new Map<string, TaggedNote>();
  const tagStmts = store.statementsMatching(undefined, MINERVA('hasTag'), undefined);
  for (const tagStmt of tagStmts) {
    const tagNode = tagStmt.object as $rdf.NamedNode;
    const nameStmts = store.statementsMatching(tagNode, MINERVA('tagName'), undefined);
    const name = nameStmts[0]?.object.value;
    if (!name) continue;
    if (name !== prefix && !name.startsWith(`${prefix}/`)) continue;
    const subject = tagStmt.subject;
    const isNote = store.statementsMatching(subject, RDF('type'), MINERVA('Note')).length > 0;
    if (!isNote) continue;
    const pathStmts = store.statementsMatching(subject, MINERVA('relativePath'), undefined);
    const relativePath = pathStmts[0]?.object.value ?? '';
    if (!relativePath || seen.has(relativePath)) continue;
    const titleStmts = store.statementsMatching(subject, DC('title'), undefined);
    seen.set(relativePath, {
      title: titleStmts[0]?.object.value ?? subject.value,
      relativePath,
    });
  }
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function notesByTag(ctx: ProjectContext, tag: string): TaggedNote[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const tagNode = tagUri(state, tag);
  const stmts = store.statementsMatching(undefined, MINERVA('hasTag'), tagNode);
  return stmts.flatMap((st) => {
    const subject = st.subject;
    // Sources also carry hasTag edges (body.md tags); filter them out —
    // sourcesByTag handles those.
    const isNote = store.statementsMatching(subject, RDF('type'), MINERVA('Note')).length > 0;
    if (!isNote) return [];
    const titleStmts = store.statementsMatching(subject, DC('title'), undefined);
    const pathStmts = store.statementsMatching(subject, MINERVA('relativePath'), undefined);
    const relativePath = pathStmts[0]?.object.value ?? '';
    if (!relativePath) return [];
    return [{
      title: titleStmts[0]?.object.value ?? subject.value,
      relativePath,
    }];
  });
}

export function sourcesByTag(ctx: ProjectContext, tag: string): TaggedSource[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const tagNode = tagUri(state, tag);
  const stmts = store.statementsMatching(undefined, MINERVA('hasTag'), tagNode);
  return stmts.flatMap((st) => {
    const subject = st.subject;
    const idStmts = store.statementsMatching(subject, MINERVA('sourceId'), undefined);
    const sourceId = idStmts[0]?.object.value;
    if (!sourceId) return [];
    const titleStmts = store.statementsMatching(subject, DC('title'), undefined);
    return [{
      sourceId,
      title: titleStmts[0]?.object.value ?? sourceId,
    }];
  });
}

/**
 * List every indexed source with its display metadata, sorted by title.
 * Used by the sidebar's Sources panel for navigation.
 */
export function listAllSources(ctx: ProjectContext): SourceMetadata[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;
  const entries: SourceMetadata[] = [];
  const seen = new Set<string>();
  const idStmts = store.statementsMatching(undefined, MINERVA('sourceId'), undefined);
  for (const st of idStmts) {
    const sourceId = st.object.value;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    entries.push(collectSourceMetadata(state, sourceId, st.subject as $rdf.NamedNode));
  }
  entries.sort((a, b) => {
    const ta = (a.title ?? a.sourceId).toLowerCase();
    const tb = (b.title ?? b.sourceId).toLowerCase();
    return ta.localeCompare(tb);
  });
  return entries;
}

export function allTags(ctx: ProjectContext): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;
  const tags = new Set<string>();
  const stmts = store.statementsMatching(undefined, RDF('type'), MINERVA('Tag'));
  for (const st of stmts) {
    const nameStmts = store.statementsMatching(st.subject, MINERVA('tagName'), undefined);
    if (nameStmts[0]) {
      tags.add(nameStmts[0].object.value);
    }
  }
  return [...tags].sort();
}

// ── Link queries ────────────────────────────────────────────────────────────

function existsPredicateFor(lt: LinkType) {
  if (lt.targetKind === 'source') return MINERVA('sourceId');
  if (lt.targetKind === 'excerpt') return MINERVA('excerptId');
  return MINERVA('relativePath');
}

export function outgoingLinks(ctx: ProjectContext, relativePath: string): OutgoingLink[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const subject = noteUri(state, relativePath);
  const results: OutgoingLink[] = [];

  for (const lt of LINK_TYPES) {
    const stmts = store.statementsMatching(subject, linkPredicate(lt), undefined);
    for (const st of stmts) {
      const targetNode = st.object as $rdf.NamedNode;
      // Note-typed link targets may carry a `#anchor` fragment. Look up the
      // bare note's metadata, not the fragmented URI. Default (undefined)
      // targetKind counts as 'note'.
      const isNoteTarget = !lt.targetKind || lt.targetKind === 'note';
      const bareNode = isNoteTarget && targetNode.value.includes('#')
        ? $rdf.sym(stripFragment(targetNode.value))
        : targetNode;
      const pathStmts = store.statementsMatching(bareNode, MINERVA('relativePath'), undefined);
      const titleStmts = store.statementsMatching(bareNode, DC('title'), undefined);
      const existsPredicate = existsPredicateFor(lt);
      const typeStmts = store.statementsMatching(bareNode, existsPredicate, undefined);
      const isExternalTarget = lt.targetKind === 'source' || lt.targetKind === 'excerpt';

      results.push({
        target: pathStmts[0]?.object.value ?? (isExternalTarget ? targetNode.value : ''),
        targetTitle: titleStmts[0]?.object.value ?? targetNode.value,
        linkType: lt.name,
        linkLabel: lt.label,
        linkColor: lt.color,
        exists: typeStmts.length > 0,
      });
    }
  }

  return results;
}

/**
 * Return the relative paths of notes with outgoing wiki-links pointing at
 * the given note. Used by the rename handler to decide which notes need
 * link rewrites.
 *
 * Only note-targeted link types are considered — cite/quote links point at
 * sources/excerpts and are handled by a separate rename path.
 */
/**
 * Find an existing derived note whose frontmatter pins it to
 * (`sourceRelativePath`, `cellId`). Used by the "Pin to notebook"
 * save path (#244) — when the source cell is pinned, the saver
 * overwrites this note rather than prompting for a new destination.
 *
 * Returns the derived note's relativePath, or null when no note in
 * the graph claims that (source, cellId) pair. Ambiguous matches
 * (more than one derived note for the same cell, e.g. after a user
 * copy) return the lexicographically-smallest path for determinism.
 */
export function findDerivedNoteForCell(
  ctx: ProjectContext,
  sourceRelativePath: string,
  cellId: string,
): string | null {
  const state = getState(ctx);
  if (!state) return null;
  const { store } = state;
  const sourceSym = noteUri(state, sourceRelativePath);
  // Notes whose prov:wasDerivedFrom points at the source. (The graph
  // indexer materialises `derived_from: [[source]]` as this triple.)
  const derivedStmts = store.statementsMatching(undefined, PROV('wasDerivedFrom'), sourceSym);
  const candidates: string[] = [];
  for (const st of derivedStmts) {
    const cellStmts = store.statementsMatching(st.subject, THOUGHT('derivedFromCell'), undefined);
    const cellMatch = cellStmts.some((cs) => cs.object.value === cellId);
    if (!cellMatch) continue;
    const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
    const p = pathStmts[0]?.object.value;
    if (p && p.endsWith('.md')) candidates.push(p);
  }
  if (candidates.length === 0) return null;
  candidates.sort();
  return candidates[0];
}

export function findNotesLinkingTo(ctx: ProjectContext, targetRelativePath: string): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;
  const targetBase = noteUri(state, targetRelativePath).value;
  const seen = new Set<string>();

  // Pass 1: every triple whose object IS the target note's URI. This
  // covers typed wiki-links (minerva:supports, etc.) AND
  // frontmatter-emitted predicates that point at a note URI —
  // prov:wasDerivedFrom from `derived_from: [[note]]`, thought:decomposes
  // from `decomposes: [[note]]`, etc. (#244 acceptance criterion:
  // renaming a source should sweep the derived note's frontmatter.)
  // Using object-indexed lookup is cheap and picks up every
  // user-authored note → note edge regardless of which predicate
  // materialised it.
  const targetSym = noteUri(state, targetRelativePath);
  const exactStmts = store.statementsMatching(undefined, undefined, targetSym);
  for (const st of exactStmts) {
    const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
    const sourcePath = pathStmts[0]?.object.value;
    if (sourcePath && sourcePath.endsWith('.md')) seen.add(sourcePath);
  }

  // Pass 2: anchored variants `<targetUri>#heading`. These only come
  // from typed wiki-links (frontmatter wiki-links don't carry anchors),
  // so iterate LINK_TYPES rather than the full triple store.
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    const stmts = store.statementsMatching(undefined, linkPredicate(lt), undefined);
    for (const st of stmts) {
      const objValue = st.object.value;
      if (!objValue.startsWith(`${targetBase}#`)) continue;
      const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
      const sourcePath = pathStmts[0]?.object.value;
      if (sourcePath && sourcePath.endsWith('.md')) seen.add(sourcePath);
    }
  }

  return [...seen];
}

export function backlinks(ctx: ProjectContext, relativePath: string): Backlink[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const targetBase = noteUri(state, relativePath).value;
  const results: Backlink[] = [];

  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    const stmts = store.statementsMatching(undefined, linkPredicate(lt), undefined);
    for (const st of stmts) {
      const objValue = st.object.value;
      if (objValue !== targetBase && !objValue.startsWith(`${targetBase}#`)) continue;
      const sourceNode = st.subject;
      const pathStmts = store.statementsMatching(sourceNode, MINERVA('relativePath'), undefined);
      const titleStmts = store.statementsMatching(sourceNode, DC('title'), undefined);

      const sourcePath = pathStmts[0]?.object.value ?? '';
      if (!sourcePath) continue;

      results.push({
        source: sourcePath,
        sourceTitle: titleStmts[0]?.object.value ?? sourceNode.value,
        linkType: lt.name,
        linkLabel: lt.label,
        linkColor: lt.color,
      });
    }
  }

  return results;
}

/**
 * Safe-delete pre-flight (#429). Given the set of notes about to be
 * deleted, return every inbound edge whose source is *not* itself in
 * the set — i.e. the edges that would become broken links if the
 * delete proceeded. Records are deduped per (target, source) and
 * carry a count + a representative typed link-label when available.
 *
 * Selection-internal edges (where source ∈ paths) are filtered out so
 * the "closed loop" case (A↔B both in the set) proceeds silently.
 * Self-statements about the target node (its own type / title / path
 * triples) are ignored — they aren't *inbound from another note*.
 *
 * Non-.md paths and unknown paths are skipped without error.
 */
export function findExternalInboundLinks(
  ctx: ProjectContext,
  paths: string[],
): SafeDeleteBlocker[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const targetSet = new Set(paths.filter((p) => p.endsWith('.md')));
  if (targetSet.size === 0) return [];

  // Build (path → noteUri) once and a reverse map (uriValue → path) so
  // pass-A (anchored typed links) can identify which target a given
  // object IRI points at without re-walking the set per statement.
  const targetUris = new Map<string, $rdf.NamedNode>();
  const uriToPath = new Map<string, string>();
  for (const p of targetSet) {
    const u = noteUri(state, p);
    targetUris.set(p, u);
    uriToPath.set(u.value, p);
  }

  // Predicate IRIs we consider "typed" — used both to label rows and
  // to skip those predicates in the untyped sweep below (since we'll
  // have already counted them with a richer label).
  const typedPredByIri = new Map<string, LinkType>();
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    typedPredByIri.set(linkPredicate(lt).value, lt);
  }

  type Row = SafeDeleteBlocker;
  const byKey = new Map<string, Row>();
  const ensureRow = (target: string, sourceNode: $rdf.NamedNode): Row | null => {
    const pathStmts = store.statementsMatching(sourceNode, MINERVA('relativePath'), undefined);
    const sourcePath = pathStmts[0]?.object.value;
    if (!sourcePath || !sourcePath.endsWith('.md')) return null;
    if (targetSet.has(sourcePath)) return null;
    const key = `${target} ${sourcePath}`;
    let row = byKey.get(key);
    if (!row) {
      const titleStmts = store.statementsMatching(sourceNode, DC('title'), undefined);
      row = {
        target,
        source: sourcePath,
        sourceTitle: titleStmts[0]?.object.value ?? sourcePath,
        linkLabel: null,
        linkCount: 0,
      };
      byKey.set(key, row);
    }
    return row;
  };

  // Pass A — typed link predicates. Match both exact target IRI and
  // anchored variants (`#heading`). This pass owns the linkLabel.
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    const stmts = store.statementsMatching(undefined, linkPredicate(lt), undefined);
    for (const st of stmts) {
      const objValue = st.object.value;
      const hashIdx = objValue.indexOf('#');
      const baseValue = hashIdx === -1 ? objValue : objValue.slice(0, hashIdx);
      const target = uriToPath.get(baseValue);
      if (!target) continue;
      const row = ensureRow(target, st.subject as $rdf.NamedNode);
      if (!row) continue;
      row.linkCount += 1;
      if (!row.linkLabel) row.linkLabel = lt.label;
    }
  }

  // Pass B — untyped sweep. Catches frontmatter wiki-links that
  // materialise as `prov:wasDerivedFrom`, `thought:decomposes`, plain
  // `[[…]]` → `minerva:linksTo`, etc. Skip predicates already covered
  // by pass A so we don't double-count, and skip self-statements.
  for (const [target, targetSym] of targetUris) {
    for (const st of store.statementsMatching(undefined, undefined, targetSym)) {
      if (typedPredByIri.has(st.predicate.value)) continue;
      if (st.subject.equals(targetSym)) continue;
      const row = ensureRow(target, st.subject as $rdf.NamedNode);
      if (!row) continue;
      row.linkCount += 1;
    }
  }

  // Order for stable display: by target, then source.
  return [...byKey.values()].sort((a, b) =>
    a.target.localeCompare(b.target) || a.source.localeCompare(b.source),
  );
}

// ── Source detail queries ───────────────────────────────────────────────────

const READ_STATUS_VALUES: ReadonlySet<ReadStatus> = new Set(['unread', 'reading', 'read', 'skipped']);

export function getSourceDetail(ctx: ProjectContext, sourceId: string): SourceDetail | null {
  const state = getState(ctx);
  if (!state) return null;
  const { store } = state;

  const subject = sourceUri(state, sourceId);
  // Probe for existence via sourceId triple (which indexSource always writes).
  const exists = store.statementsMatching(subject, MINERVA('sourceId'), undefined).length > 0;
  if (!exists) return null;

  const metadata = collectSourceMetadata(state, sourceId, subject);
  const excerpts = collectExcerptsForSource(state, subject);
  const backlinks = collectSourceBacklinks(state, subject, excerpts);
  const aboutNotes = collectSourceAboutNotes(state, subject);
  const references = collectSourceReferences(state, subject);

  return { metadata, excerpts, backlinks, aboutNotes, references };
}

/**
 * Outgoing `minerva:references` edges from this source (#106) —
 * the bibliography stubs created by reference mining.
 */
function collectSourceReferences(state: GraphState, sourceSubject: $rdf.NamedNode): SourceReference[] {
  const { store } = state;
  const out: SourceReference[] = [];
  const seen = new Set<string>();
  for (const st of store.statementsMatching(sourceSubject, MINERVA('references'), undefined)) {
    const targetSubject = st.object as $rdf.NamedNode;
    const idStmts = store.statementsMatching(targetSubject, MINERVA('sourceId'), undefined);
    const targetId = idStmts[0]?.object.value;
    if (!targetId || seen.has(targetId)) continue;
    seen.add(targetId);
    const titleStmts = store.statementsMatching(targetSubject, DC('title'), undefined);
    const stubStmts = store.statementsMatching(targetSubject, THOUGHT('stubStatus'), undefined);
    out.push({
      sourceId: targetId,
      title: titleStmts[0]?.object.value ?? targetId,
      stubStatus: stubStmts[0]?.object.value ?? null,
    });
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

function collectSourceMetadata(state: GraphState, sourceId: string, subject: $rdf.NamedNode): SourceMetadata {
  const { store } = state;

  // Pick the most specific thought:* type we recognize (not the generic Source).
  let subtype: string | null = null;
  const typeStmts = store.statementsMatching(subject, RDF('type'), undefined);
  for (const st of typeStmts) {
    const val = st.object.value;
    if (!val.startsWith(THOUGHT('').value)) continue;
    const local = val.slice(THOUGHT('').value.length);
    if (local === 'Source' || local === 'Component') continue;
    subtype = local;
    break;
  }

  const creators: string[] = [];
  for (const st of store.statementsMatching(subject, DC('creator'), undefined)) {
    const v = st.object.value;
    if (!creators.includes(v)) creators.push(v);
  }

  const first = (pred: ReturnType<typeof MINERVA>): string | null => {
    const stmts = store.statementsMatching(subject, pred, undefined);
    return stmts[0]?.object.value ?? null;
  };

  const issued = first(DC('issued'));
  const rawReadStatus = first(MINERVA('readStatus'));
  const readStatus = rawReadStatus && READ_STATUS_VALUES.has(rawReadStatus as ReadStatus)
    ? rawReadStatus as ReadStatus
    : null;
  return {
    sourceId,
    subtype,
    title: first(DC('title')),
    creators,
    year: issued ? issued.slice(0, 4) : null,
    publisher: first(DC('publisher')),
    doi: first(BIBO('doi')),
    uri: first(BIBO('uri')),
    abstract: first(DC('abstract')),
    readStatus,
    readDueBy: first(MINERVA('readDueBy')),
    stubStatus: first(THOUGHT('stubStatus')),
  };
}

/**
 * Built-in Reading Queue views (#116). Each view resolves to a set
 * of sourceIds via a hardcoded predicate evaluated against the live
 * graph — distinct from user-defined smart collections which can't
 * (yet) express date-relative facets.
 */
export type ReadingQueueView = 'unread' | 'reading' | 'dueThisWeek' | 'recentlyFinished';

const DAY_MS = 86_400_000;

/**
 * Source ids matching the given queue view. `now` is injectable for
 * deterministic tests; production callers pass nothing and get the
 * current wall clock.
 *
 *   unread           — readStatus is unset OR explicitly 'unread'
 *   reading          — readStatus = 'reading'
 *   dueThisWeek      — readDueBy is set AND ≤ now + 7 days (past-due included)
 *   recentlyFinished — readStatus = 'read' AND dc:modified within last 30 days
 */
export function getReadingQueueSourceIds(
  ctx: ProjectContext,
  view: ReadingQueueView,
  now: Date = new Date(),
): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  // Walk every source. Project sizes are O(1000), so a single pass
  // beats running multiple statementsMatching queries.
  const sourceStmts = store.statementsMatching(undefined, MINERVA('sourceId'), undefined);
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const st of sourceStmts) {
    const subject = st.subject;
    const sourceId = st.object.value;
    if (!sourceId || seen.has(sourceId)) continue;

    const status = store.statementsMatching(subject, MINERVA('readStatus'), undefined)[0]?.object.value ?? null;

    if (view === 'unread') {
      if (status === null || status === 'unread') {
        seen.add(sourceId); matched.push(sourceId);
      }
      continue;
    }
    if (view === 'reading') {
      if (status === 'reading') {
        seen.add(sourceId); matched.push(sourceId);
      }
      continue;
    }
    if (view === 'dueThisWeek') {
      const due = store.statementsMatching(subject, MINERVA('readDueBy'), undefined)[0]?.object.value;
      if (!due) continue;
      const dueMs = Date.parse(due);
      if (Number.isNaN(dueMs)) continue;
      if (dueMs <= now.getTime() + 7 * DAY_MS) {
        seen.add(sourceId); matched.push(sourceId);
      }
      continue;
    }
    if (view === 'recentlyFinished') {
      if (status !== 'read') continue;
      const modified = store.statementsMatching(subject, DC('modified'), undefined)[0]?.object.value;
      if (!modified) continue;
      const mMs = Date.parse(modified);
      if (Number.isNaN(mMs)) continue;
      if (mMs >= now.getTime() - 30 * DAY_MS) {
        seen.add(sourceId); matched.push(sourceId);
      }
      continue;
    }
    // Exhaustiveness — tells future contributors when they extend the union.
    const _exhaustive: never = view;
    throw new Error(`Unknown queue view: ${String(_exhaustive)}`);
  }
  return matched;
}

/**
 * Sources tagged with a particular reading status (#116). Used by
 * the smart-collection resolver and by sidebar filters that surface
 * "Unread" / "Reading" / "Read" buckets.
 */
export function sourcesByReadStatus(ctx: ProjectContext, status: ReadStatus): { sourceId: string }[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const stmts = store.statementsMatching(undefined, MINERVA('readStatus'), $rdf.lit(status));
  const out: { sourceId: string }[] = [];
  const seen = new Set<string>();
  for (const st of stmts) {
    const idStmts = store.statementsMatching(st.subject, MINERVA('sourceId'), undefined);
    const sourceId = idStmts[0]?.object.value;
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    out.push({ sourceId });
  }
  return out;
}

function collectExcerptsForSource(state: GraphState, sourceSubject: $rdf.NamedNode): SourceExcerpt[] {
  const { store } = state;

  const excerpts: SourceExcerpt[] = [];
  const seen = new Set<string>();
  const stmts = store.statementsMatching(undefined, THOUGHT('fromSource'), sourceSubject);
  for (const st of stmts) {
    const ex = st.subject as $rdf.NamedNode;
    const idStmts = store.statementsMatching(ex, MINERVA('excerptId'), undefined);
    const id = idStmts[0]?.object.value;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const first = (pred: ReturnType<typeof MINERVA>): string | null => {
      const s = store.statementsMatching(ex, pred, undefined);
      return s[0]?.object.value ?? null;
    };

    excerpts.push({
      excerptId: id,
      citedText: first(THOUGHT('citedText')),
      page: first(THOUGHT('page')),
      pageRange: first(THOUGHT('pageRange')),
      locationText: first(THOUGHT('locationText')),
    });
  }
  excerpts.sort((a, b) => a.excerptId.localeCompare(b.excerptId));
  return excerpts;
}

function collectSourceBacklinks(
  state: GraphState,
  sourceSubject: $rdf.NamedNode,
  excerpts: SourceExcerpt[],
): SourceBacklink[] {
  const { store } = state;

  const results: SourceBacklink[] = [];
  const seen = new Set<string>();

  const pushBacklink = (noteSubject: $rdf.NamedNode, kind: 'cite' | 'quote', viaExcerptId?: string) => {
    const pathStmts = store.statementsMatching(noteSubject, MINERVA('relativePath'), undefined);
    const relativePath = pathStmts[0]?.object.value;
    if (!relativePath) return;
    const key = `${kind}::${relativePath}::${viaExcerptId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const titleStmts = store.statementsMatching(noteSubject, DC('title'), undefined);
    results.push({
      relativePath,
      title: titleStmts[0]?.object.value ?? relativePath,
      kind,
      viaExcerptId,
    });
  };

  // Direct cites
  for (const st of store.statementsMatching(undefined, THOUGHT('cites'), sourceSubject)) {
    pushBacklink(st.subject as $rdf.NamedNode, 'cite');
  }

  // Quotes of excerpts that belong to this source
  for (const ex of excerpts) {
    const exNode = excerptUri(state, ex.excerptId);
    for (const st of store.statementsMatching(undefined, THOUGHT('quotes'), exNode)) {
      pushBacklink(st.subject as $rdf.NamedNode, 'quote', ex.excerptId);
    }
  }

  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

/**
 * Notes whose frontmatter declares them as *about* this source (#474).
 * Driven by `dc:subject` edges from a Minerva note to the source URI —
 * the frontmatter resolver materialises `about: [[sources/<id>]]` into
 * exactly this triple. Distinct from cite/quote backlinks: this is
 * subject-of, not reference-of.
 */
function collectSourceAboutNotes(state: GraphState, sourceSubject: $rdf.NamedNode): SourceAboutNote[] {
  const { store } = state;
  const results: SourceAboutNote[] = [];
  const seen = new Set<string>();
  for (const st of store.statementsMatching(undefined, DC('subject'), sourceSubject)) {
    const subject = st.subject as $rdf.NamedNode;
    // Only count actual notes — a future excerpt or proposal could
    // carry dc:subject too, and the source detail's Notes section is
    // specifically for prose commentary.
    const isNote = store.statementsMatching(subject, RDF('type'), MINERVA('Note')).length > 0;
    if (!isNote) continue;
    const pathStmts = store.statementsMatching(subject, MINERVA('relativePath'), undefined);
    const relativePath = pathStmts[0]?.object.value;
    if (!relativePath || seen.has(relativePath)) continue;
    seen.add(relativePath);
    const titleStmts = store.statementsMatching(subject, DC('title'), undefined);
    results.push({
      relativePath,
      title: titleStmts[0]?.object.value ?? relativePath,
    });
  }
  results.sort((a, b) => a.title.localeCompare(b.title));
  return results;
}

/**
 * Per-source aggregation of every citation a note makes (#111).
 *
 * Walks the indexed `thought:cites` and `thought:quotes` edges from
 * the note. The graph stores at most one edge per (note, predicate,
 * target) pair regardless of how many times the citation appears
 * inline, so we re-scan the note's content to derive *occurrence
 * counts* — that's the bit users actually want when they're seeing
 * "this source is referenced 4 times in this note." The graph drives
 * the source set, the content drives the count.
 */
export function citationsForNote(
  ctx: ProjectContext,
  relativePath: string,
  content: string,
): import('../../shared/types').CitationGroup[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;
  const noteSubject = noteUri(state, relativePath);

  // Source URIs the note cites — keyed by URI string because rdflib
  // hands back fresh NamedNode instances per call, so a JS Set on the
  // node would treat them as distinct.
  const sourceUris = new Map<string, $rdf.NamedNode>();
  for (const st of store.statementsMatching(noteSubject, THOUGHT('cites'), undefined)) {
    const node = st.object as $rdf.NamedNode;
    sourceUris.set(node.value, node);
  }

  // Quote edges → set of excerpts the note quotes; resolve each to its
  // owning source. An excerpt without a fromSource link is malformed
  // ingest output; skip silently rather than surfacing a half-row.
  for (const st of store.statementsMatching(noteSubject, THOUGHT('quotes'), undefined)) {
    const excerptNode = st.object as $rdf.NamedNode;
    const fromStmts = store.statementsMatching(excerptNode, THOUGHT('fromSource'), undefined);
    const sourceNode = fromStmts[0]?.object as $rdf.NamedNode | undefined;
    if (!sourceNode) continue;
    sourceUris.set(sourceNode.value, sourceNode);
  }

  // Count inline occurrences in the note content. Use the same
  // typed-link regex as the editor's decoration rules so anything
  // visible to the user as a citation is counted as one. Strip
  // bibliography-block content (#113) so its rendered entries don't
  // re-inflate the count for sources that no longer have inline cites.
  const countable = content.replace(
    /<!-- minerva:bibliography -->[\s\S]*?<!-- \/minerva:bibliography -->/g,
    '',
  );
  const occurrences = new Map<string, number>(); // key: `cite:id` or `quote:ex`
  const RE = /\[\[(cite|quote)::([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(countable)) !== null) {
    const kind = m[1].toLowerCase();
    const id = m[2].trim();
    const key = `${kind}:${id}`;
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }

  const groups: import('../../shared/types').CitationGroup[] = [];
  for (const sourceNode of sourceUris.values()) {
    const idStmts = store.statementsMatching(sourceNode, MINERVA('sourceId'), undefined);
    const sourceId = idStmts[0]?.object.value;
    if (!sourceId) continue;
    const meta = collectSourceMetadata(state, sourceId, sourceNode);

    // Cites: occurrences keyed by the source id directly.
    const citeCount = occurrences.get(`cite:${sourceId}`) ?? 0;

    // Quotes: walk every excerpt whose fromSource is this source AND
    // whose id appears in the note. Per-excerpt count comes from the
    // occurrence map.
    const allExcerpts = collectExcerptsForSource(state, sourceNode);
    const noteExcerpts: (import('../../shared/types').SourceExcerpt & { quoteCount: number })[] = [];
    let totalQuoteCount = 0;
    for (const ex of allExcerpts) {
      const c = occurrences.get(`quote:${ex.excerptId}`) ?? 0;
      if (c === 0) continue;
      noteExcerpts.push({ ...ex, quoteCount: c });
      totalQuoteCount += c;
    }

    // A source ends up in the result set when EITHER it's directly
    // cited or one of its excerpts is quoted. If both counts are zero,
    // the graph thinks the note references it but the content doesn't —
    // possible during transient indexer/disk skew. Skip silently.
    if (citeCount === 0 && totalQuoteCount === 0) continue;

    groups.push({
      sourceId,
      title: meta.title,
      year: meta.year,
      creators: meta.creators,
      citeCount,
      quoteCount: totalQuoteCount,
      excerpts: noteExcerpts,
    });
  }

  // Stable, useful order: most-cited first, then alpha by title for
  // ties. "Most-cited first" matches the user's mental model of
  // skimming a paper — the heavy hitters at the top.
  groups.sort((a, b) => {
    const totalA = a.citeCount + a.quoteCount;
    const totalB = b.citeCount + b.quoteCount;
    if (totalA !== totalB) return totalB - totalA;
    const ta = (a.title ?? a.sourceId).toLowerCase();
    const tb = (b.title ?? b.sourceId).toLowerCase();
    return ta.localeCompare(tb);
  });
  return groups;
}

/** Resolve an excerpt-id to the sourceId of its fromSource, or null if not found. */
export function getExcerptSource(ctx: ProjectContext, excerptId: string): { sourceId: string } | null {
  const state = getState(ctx);
  if (!state) return null;
  const { store } = state;
  const ex = excerptUri(state, excerptId);
  const stmts = store.statementsMatching(ex, THOUGHT('fromSource'), undefined);
  const sourceNode = stmts[0]?.object as $rdf.NamedNode | undefined;
  if (!sourceNode) return null;
  const idStmts = store.statementsMatching(sourceNode, MINERVA('sourceId'), undefined);
  const id = idStmts[0]?.object.value;
  return id ? { sourceId: id } : null;
}
