/**
 * Graph write / indexing layer (#671, increment 3).
 *
 * The write side of the graph package: every `index*` / `remove*` function that
 * mutates the per-project `GraphState.store`, plus its exclusive helpers (link
 * resolution, alias-map rebuild, frontmatter→term coercion, ontology bootstrap,
 * full-tree walks). All store-mutating entry points run through the LLM write
 * guard (`checkLLMWriteGuard`).
 *
 * Imports its foundations from `./state` (never from `./index`, to keep the
 * package acyclic) and `findNotesLinkingToAnchorImpl` from `./queries`. `./index`
 * re-exports this module's public surface so external
 * `import * as graph from './graph/index'` callers are unchanged.
 */

import * as $rdf from 'rdflib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseMarkdown } from './parser';
import { getLinkType } from '../../shared/link-types';
import { slugify } from '../../shared/slug';
import { stripNoteExt } from '../../shared/note-extensions';
import { isIndexable } from '../notebase/indexable-files';
import { isIgnoredEntry } from '../notebase/ignored-dirs';
import { logger } from '../../shared/logger';

import type { ProjectContext } from '../project-context-types';

import {
  type GraphState, type HeadingSnapshot,
  getState, invalidate, resetN3Mirror, instrumentStoreMirror,
  MINERVA, DC, RDF, THOUGHT, TYPES,
  noteUri, tagUri, folderUri, projectUri,
  linkPredicate, dateLit,
} from './state';
import { loadTypeCatalog } from '../types/loader';
import { materializeTypeClasses } from '../types/compile';
import type { PropertyType } from '../../shared/objects/type-def';

import { checkLLMWriteGuard } from './write-guard';
import {
  fileMtimeIso, injectPrefixes,
  ensureTag, ensureFolder, flattenFrontmatterStrings,
  buildLinkResolveCtx, resolveLinkTarget, type LinkResolveCtx,
} from './index-helpers';
import { walkAndIndexExcerpts } from './indexers/excerpt';
import { walkAndIndexSources } from './indexers/source';
import { indexTurtleFile, indexCsvFile, indexPythonFile } from './indexers/note-files';
import { indexTable } from './indexers/tables';

// `findNotesLinkingToAnchorImpl` is a queries-layer helper; detectHeadingRename
// (an indexer-only helper below) reuses it.
import { findNotesLinkingToAnchorImpl } from './queries';

// ── URI helpers ─────────────────────────────────────────────────────────────
// The state-taking URI helpers (noteUri, tagUri, folderUri, sourceUri,
// excerptUri, tableUri, projectUri, linkPredicate) live in ./state; the shared
// link-resolution helpers (LinkResolveCtx / buildLinkResolveCtx /
// resolveLinkTarget) live in ./index-helpers (#1624). Both are imported above.

/**
 * Aliases that contain wiki-link metacharacters can't be expressed as
 * `[[alias]]` and so couldn't be resolved anyway. Reject them with a
 * one-line console warning instead of crashing or silently misindexing.
 */
const INVALID_ALIAS_CHAR = /[[\]|#\n]/;

function isAliasNameValid(name: string): boolean {
  if (!name) return false;
  if (INVALID_ALIAS_CHAR.test(name)) return false;
  if (name.length > 200) return false;
  return true;
}

/**
 * Recompute `state.aliasMap` from `state.aliasesPerNote`. Run after
 * any change to the per-note snapshots — a full reindex (which clears
 * everything first) and the incremental `indexNote` path both call this.
 *
 * Conflict policy: when two notes claim the same alias, the
 * lexicographically-smaller relativePath wins. Title / filename-stem
 * matches always win over aliases — the second loop drops alias keys
 * that collide with a canonical note name.
 */
function rebuildAliasMap(state: GraphState): void {
  const next = new Map<string, string>();
  // Sort note paths so the conflict tiebreak is deterministic.
  const paths = [...state.aliasesPerNote.keys()].sort();
  for (const path of paths) {
    const aliases = state.aliasesPerNote.get(path) ?? [];
    for (const alias of aliases) {
      const key = alias.toLowerCase();
      if (next.has(key)) continue; // first writer wins (alphabetical by path)
      next.set(key, path);
    }
  }
  // Drop alias keys that collide with a canonical name (a real note's
  // path stem or the lowercase of its basename). Iterate every
  // indexed note, not just those with aliases — a real file at
  // `JFK.md` should beat any other note's "JFK" alias.
  for (const path of state.indexedNotePaths) {
    const stem = stripNoteExt(path).toLowerCase();
    next.delete(stem);
    const basename = stem.split('/').pop() ?? '';
    if (basename) next.delete(basename);
  }
  state.aliasMap = next;
}

// ── Frontmatter helpers ─────────────────────────────────────────────────────
// Split out to ./indexers/frontmatter.ts (#1905) — the frontmatter→RDF value
// mapping is a self-contained concern that never touches orchestration.
// `reloadTypeCatalog` below stays here: it's type-catalog orchestration, not
// value mapping, even though it sat in the middle of the old block.
import {
  emitFrontmatterValue,
  resolveFrontmatterPredicate,
  declaredPropertyPredicate,
} from './indexers/frontmatter';
export { resolveFrontmatterPredicate, declaredPropertyPredicate };

/**
 * Reload the type catalog into graph state + re-materialize the type classes,
 * WITHOUT a full note reindex — so a freshly-saved user type ("Save Note as
 * Object Type") is immediately usable for promotion + indexing. Materialize is
 * idempotent (store.add dedupes), so re-adding existing classes is harmless.
 */
export async function reloadTypeCatalog(ctx: ProjectContext): Promise<void> {
  const state = getState(ctx);
  if (!state) return;
  state.typeCatalog = await loadTypeCatalog(state.rootPath);
  materializeTypeClasses(state.store, state.typeCatalog);
}

/**
 * `dc:modified` should reflect the user's last edit, not the indexer's
 * last sweep — otherwise checkStaleness sees every note as just-modified
 * and is always-empty theatre (#336). Read mtime from disk; fall back to
 * `now` only when the file is gone (mid-rename race) so the triple is
 * still well-formed.
 */
// ── Heading snapshots ──────────────────────────────────────────────────────
// HeadingSnapshot moved up into per-project state (#333). Snapshots live
// on `state.headingsPerNote` — used by indexNote to spot the case where
// a single heading was renamed so we can offer to rewrite
// `[[note#oldSlug]]` links across the thoughtbase. Cleared on initGraph
// so a reindex from empty doesn't surface phantom renames for every note.

/** ATX-style headings only (`# …` — `###### …`). Setext headings are ignored in v1. */
const HEADING_LINE_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function extractHeadingsFromContent(content: string): HeadingSnapshot[] {
  const out: HeadingSnapshot[] = [];
  const seenSlugs = new Set<string>();
  let inFence = false;
  for (const line of content.split('\n')) {
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(HEADING_LINE_RE);
    if (!m) continue;
    const text = m[2]!.trim();
    const slug = slugify(text);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    out.push({ slug, text, level: m[1]!.length });
  }
  return out;
}

export interface HeadingRenameCandidate {
  relativePath: string;
  oldSlug: string;
  oldText: string;
  newSlug: string;
  newText: string;
  incomingLinkCount: number;
}

// ── Ontology bootstrap ──────────────────────────────────────────────────────

import ONTOLOGY_TTL from '../../shared/ontology.ttl?raw';
import THOUGHT_ONTOLOGY_TTL from '../../shared/ontology-thought.ttl?raw';
import { emitGraphChanged } from './graph-events';

// Ontology triples are loaded fresh on every startup and are not persisted
// to .minerva/graph.ttl. Holding the parsed statements lets us (1) self-heal
// old graph.ttl files that included the ontology by removing any matching
// triples, and (2) strip them before writing on persistGraph().

export function addOntologyToStore(state: GraphState): void {
  const tempStore = $rdf.graph();
  try {
    $rdf.parse(ONTOLOGY_TTL, tempStore, MINERVA('').value, 'text/turtle');
  } catch { /* ontology parse failure is non-fatal */ }
  try {
    $rdf.parse(THOUGHT_ONTOLOGY_TTL, tempStore, THOUGHT('').value, 'text/turtle');
  } catch { /* thought ontology parse failure is non-fatal */ }
  state.ontologyStatements = tempStore.statements.slice();
  for (const st of state.ontologyStatements) {
    state.store.removeMatches(st.subject, st.predicate, st.object);
  }
  for (const st of state.ontologyStatements) {
    state.store.add(st.subject, st.predicate, st.object, st.graph);
  }
}

// ── Indexing ────────────────────────────────────────────────────────────────

export interface IndexNoteOptions {
  /**
   * Skip the per-note `rebuildAliasMap` call (perf #1106). `rebuildAliasMap`
   * is O(N) in the project's total note count, so calling it once per note
   * during a full `indexAllNotes` walk is O(N²) — at 5,000 notes, tens of
   * millions of wasted inner iterations. `indexAllNotes` already runs a
   * complete alias pre-pass (`walkAndCollectAliases`) before this loop starts
   * and rebuilds once more after it ends, so the per-note rebuild here is
   * pure redundancy in that path. The incremental single-note path (a save,
   * a rename, a merge, …) still needs it — that path never runs the pre-pass
   * or a trailing rebuild, so skipping it there would leave `aliasMap` stale.
   */
  skipAliasRebuild?: boolean;
  /**
   * Prebuilt wiki-link resolution context (perf #1473). `indexAllNotes` builds
   * it ONCE — after the alias pre-pass has settled `indexedNotePaths` + the
   * alias map — and threads it into every `indexNote` so the per-note
   * `buildLinkResolveCtx` (O(N)) doesn't run N times. Omitted on the standalone
   * single-note path, which builds its own.
   */
  linkCtx?: LinkResolveCtx;
}

type ParsedNote = ReturnType<typeof parseMarkdown>;

/** Note type + title + filename/path + disk mtime + folder + project membership
 *  — the core triples every markdown note gets. */
function indexNoteCoreTriples(
  state: GraphState,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
  relativePath: string,
  title: string,
): void {
  const { store } = state;
  store.add(subject, RDF('type'), MINERVA('Note'), graph);
  store.add(subject, DC('title'), $rdf.lit(title), graph);
  store.add(subject, MINERVA('filename'), $rdf.lit(path.basename(relativePath)), graph);
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath), graph);
  // dc:modified is the user's last edit from disk mtime, not the indexer's clock (#336).
  store.add(subject, DC('modified'), dateLit(fileMtimeIso(state, relativePath)), graph);
  const dir = path.dirname(relativePath);
  if (dir && dir !== '.') {
    store.add(subject, MINERVA('inFolder'), folderUri(state, dir), graph);
    ensureFolder(state, dir);
  }
  store.add(projectUri(state), MINERVA('containsNote'), subject, graph);
}

/** Body (`#foo`) + frontmatter (`tags: [...]`) tags as `minerva:hasTag` resources. */
function indexNoteTags(state: GraphState, subject: $rdf.NamedNode, graph: $rdf.NamedNode, parsed: ParsedNote): void {
  const { store } = state;
  const bodyTags = new Set(parsed.tags);
  const fmTagValue = parsed.frontmatter.tags;
  if (fmTagValue !== undefined) {
    for (const t of flattenFrontmatterStrings(fmTagValue)) if (t) bodyTags.add(t);
  }
  for (const tag of bodyTags) {
    const tagNode = tagUri(state, tag);
    ensureTag(state, tagNode, tag);
    store.add(subject, MINERVA('hasTag'), tagNode, graph);
  }
}

/** Materialize `type:` frontmatter as `rdf:type` edges to registered classes
 *  (`types:Book`) so `?x rdf:type types:Book` is queryable; return the declared
 *  property→type map for datatype coercion in the frontmatter loop (#1062/#1063).
 *  Unknown type ids are ignored (no class edge). */
function indexNoteDomainType(
  state: GraphState,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
  parsed: ParsedNote,
): Map<string, PropertyType> | undefined {
  const { store } = state;
  const fmType = parsed.frontmatter.type;
  if (fmType === undefined) return undefined;
  let declaredProps: Map<string, PropertyType> | undefined;
  for (const typeId of flattenFrontmatterStrings(fmType)) {
    const def = state.typeCatalog.types.find((t) => t.id === typeId.trim().toLowerCase());
    if (!def) continue;
    store.add(subject, RDF('type'), TYPES(def.classLocalName), graph);
    declaredProps ??= new Map();
    for (const p of def.properties) if (!declaredProps.has(p.name)) declaredProps.set(p.name, p.type);
  }
  return declaredProps;
}

/** Frontmatter aliases (#469): track per-note (so a later reindex drops stale
 *  ones), rebuild the resolver map, and emit `minerva:hasAlias`. Aliases with
 *  wiki-link metacharacters are dropped — they couldn't be written as `[[alias]]`. */
function indexNoteAliases(
  state: GraphState,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
  relativePath: string,
  parsed: ParsedNote,
  skipAliasRebuild: boolean,
): void {
  const { store } = state;
  // (Path registration hoisted to the top of indexNote so non-md notes register
  // too; #1446.)
  const validAliases = parsed.aliases.filter(isAliasNameValid);
  if (validAliases.length > 0) state.aliasesPerNote.set(relativePath, validAliases);
  else state.aliasesPerNote.delete(relativePath);
  if (!skipAliasRebuild) rebuildAliasMap(state);
  for (const alias of validAliases) store.add(subject, MINERVA('hasAlias'), $rdf.lit(alias), graph);
}

/** Wiki-links → typed predicate edges, using the (possibly pass-wide) resolver. */
function indexNoteWikiLinks(
  state: GraphState,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
  parsed: ParsedNote,
  linkCtx: LinkResolveCtx,
): void {
  const { store } = state;
  for (const link of parsed.links) {
    const predicate = linkPredicate(getLinkType(link.type));
    const targetNode = resolveLinkTarget(state, getLinkType(link.type), link.target, linkCtx, link.anchor);
    store.add(subject, predicate, targetNode, graph);
  }
}

export async function indexNote(
  ctx: ProjectContext,
  relativePath: string,
  content: string,
  opts: IndexNoteOptions = {},
): Promise<{ headingRenameCandidate?: HeadingRenameCandidate }> {
  try {
    return await indexNoteImpl(ctx, relativePath, content, opts);
  } finally {
    // Signals "the graph may have changed" (#1795), including the early-return
    // paths — a .ttl or .csv note still writes triples. Debounced downstream.
    emitGraphChanged(ctx.rootPath);
  }
}

// The body is synchronous after the #1624 decomposition, but indexNote stays
// async: it's part of the graph write API and every call site `await`s it
// alongside genuinely-async index work (making it sync trips await-thenable at
// ~360 call/await sites). Hence the scoped require-await suppression.
// eslint-disable-next-line @typescript-eslint/require-await
async function indexNoteImpl(
  ctx: ProjectContext,
  relativePath: string,
  content: string,
  opts: IndexNoteOptions = {},
): Promise<{ headingRenameCandidate?: HeadingRenameCandidate }> {
  checkLLMWriteGuard('indexNote');
  const state = getState(ctx);
  if (!state) return {};
  // Any successful exit through this function has mutated the rdflib
  // store; flag the N3 mirror as stale once, at the boundary, instead
  // of after every internal store.add.
  invalidate(state);
  const { store, headingsPerNote } = state;

  const subject = noteUri(state, relativePath);
  const graph = subject; // named graph = note URI, for clean removal on re-index

  // Register the note path up front — for ALL note extensions (#1446), before the
  // `.ttl`/`.csv`/`.py` early-returns below. This feeds the wiki-link resolver
  // index (buildLinkResolveCtx) + alias canonical-name set, so a bare `[[budget]]`
  // resolves to a `budget.csv` even on the incremental (single-note) path, not
  // just a full rebuild. Idempotent (`indexedNotePaths` is a Set).
  state.indexedNotePaths.add(relativePath);

  // Remove ALL triples from this note's graph (handles arbitrary turtle subjects)
  store.removeMatches(undefined, undefined, undefined, graph);
  // Also remove any legacy triples with no graph (from before named-graph tracking)
  store.removeMatches(subject, undefined, undefined);

  if (relativePath.endsWith('.ttl')) {
    indexTurtleFile(state, relativePath, content, subject, graph);
    return {};
  }

  if (relativePath.endsWith('.csv')) {
    indexCsvFile(state, relativePath, content, subject, graph);
    return {};
  }

  if (relativePath.endsWith('.py')) {
    indexPythonFile(state, relativePath, subject, graph);
    return {};
  }

  // Diff headings against the previous snapshot BEFORE overwriting it so we
  // can offer to rewrite `[[note#oldSlug]]` links when a single heading
  // gets renamed. Initial index (no prior snapshot) never flags a rename.
  const prevHeadings = headingsPerNote.get(relativePath);
  const newHeadings = extractHeadingsFromContent(content);
  const headingRenameCandidate = prevHeadings
    ? detectHeadingRename(state, relativePath, prevHeadings, newHeadings)
    : undefined;
  headingsPerNote.set(relativePath, newHeadings);

  // Parse markdown
  const parsed = parseMarkdown(content);

  // Snapshot frontmatter keys for the Properties panel's project-wide
  // autocomplete (#488) — every key the user typed, including `title`/`tags`
  // (which the predicate-mapping loop below skips).
  state.frontmatterKeysPerNote.set(relativePath, Object.keys(parsed.frontmatter));

  const title = parsed.title ?? path.basename(relativePath, '.md');
  indexNoteCoreTriples(state, subject, graph, relativePath, title);
  indexNoteTags(state, subject, graph, parsed);
  // Declared property name → PropertyType, for schema-driven value coercion in
  // the frontmatter loop below (#1063).
  const declaredProps = indexNoteDomainType(state, subject, graph, parsed);
  indexNoteAliases(state, subject, graph, relativePath, parsed, opts.skipAliasRebuild ?? false);

  // Reuse the pass-wide resolver when threaded in (indexAllNotes); otherwise
  // build one for this standalone single-note reindex (#1473).
  const linkCtx = opts.linkCtx ?? buildLinkResolveCtx(state);
  indexNoteWikiLinks(state, subject, graph, parsed, linkCtx);

  // Frontmatter → triples. `title` (already used as the note title) and
  // `tags` (handled above) are skipped here so they don't double-emit.
  for (const [key, value] of Object.entries(parsed.frontmatter)) {
    // `title`/`tags` handled above; `publish` is a nested block of static-site
    // publishing directives (#1136) — a publication concern, kept out of the
    // graph (and it's an object, not a materialisable scalar anyway).
    if (key === 'title' || key === 'tags' || key === 'publish' || key === 'type') continue;
    // A typed wiki-link value (`[[supports::x]]`) overrides keyPredicate with
    // its own type; a nested mapping materialises as a blank node; everything
    // else stays a scalar edge under the key's predicate. A declared property's
    // type drives datatype coercion (#1063).
    emitFrontmatterValue(state, store, subject, declaredPropertyPredicate(key, declaredProps?.get(key)), value, graph, linkCtx, 0, declaredProps?.get(key));
  }

  // Embedded turtle blocks — parse into the note's named graph
  for (const block of parsed.turtleBlocks) {
    try {
      const prefixed = injectPrefixes(state, block, subject.value);
      $rdf.parse(prefixed, store, graph.value, 'text/turtle');
    } catch (e) {
      logger('graph').error(`Failed to parse turtle block in ${relativePath}:`, e instanceof Error ? e.message : e);
    }
  }

  // Markdown tables — CSVW triples
  for (let ti = 0; ti < parsed.tables.length; ti++) {
    indexTable(state, parsed.tables[ti]!, ti, subject, graph);
  }

  return headingRenameCandidate ? { headingRenameCandidate } : {};
}

/**
 * Detect the unambiguous case where exactly one heading slug disappeared
 * AND exactly one appeared — i.e. a single heading was renamed in place.
 * Anything else (multiple removals, pure deletion, additions without
 * removals) → no candidate.
 *
 * `incomingLinkCount` reports how many notes link to the old slug. The
 * renderer uses it to decide whether to OFFER a link rewrite (only when
 * > 0), but the candidate fires regardless of link count so the renderer
 * can also cascade purely-local state — e.g. keep a section bookmark
 * pointing at the renamed heading (#755), even when nothing links to it.
 */
function detectHeadingRename(
  state: GraphState,
  relativePath: string,
  prev: HeadingSnapshot[],
  next: HeadingSnapshot[],
): HeadingRenameCandidate | undefined {
  const nextSlugs = new Set(next.map((h) => h.slug));
  const prevSlugs = new Set(prev.map((h) => h.slug));
  const removed = prev.filter((h) => !nextSlugs.has(h.slug));
  const added = next.filter((h) => !prevSlugs.has(h.slug));
  if (removed.length !== 1 || added.length !== 1) return undefined;

  const old = removed[0]!;
  const fresh = added[0]!;
  const incoming = findNotesLinkingToAnchorImpl(state, relativePath, old.slug).length;

  return {
    relativePath,
    oldSlug: old.slug,
    oldText: old.text,
    newSlug: fresh.slug,
    newText: fresh.text,
    incomingLinkCount: incoming,
  };
}

export function removeNote(ctx: ProjectContext, relativePath: string): void {
  try {
    removeNoteImpl(ctx, relativePath);
  } finally {
    emitGraphChanged(ctx.rootPath);
  }
}

function removeNoteImpl(ctx: ProjectContext, relativePath: string): void {
  checkLLMWriteGuard('removeNote');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const subject = noteUri(state, relativePath);
  // Remove all triples in this note's named graph
  state.store.removeMatches(undefined, undefined, undefined, subject);
  // Also remove any legacy triples with no graph
  state.store.removeMatches(subject, undefined, undefined);
  // Drop the note's alias snapshot so its aliases stop resolving (#469).
  // Also remove from `indexedNotePaths` so the alias map's
  // canonical-conflict pass no longer treats this path as a real file.
  const hadAliases = state.aliasesPerNote.delete(relativePath);
  const wasTracked = state.indexedNotePaths.delete(relativePath);
  // Drop the deleted note's frontmatter-key snapshot so its keys stop
  // appearing in the project-wide autocomplete (#488).
  state.frontmatterKeysPerNote.delete(relativePath);
  state.headingsPerNote.delete(relativePath);
  if (hadAliases || wasTracked) {
    rebuildAliasMap(state);
  }
}

function ensureProject(state: GraphState): void {
  const { store, rootPath } = state;
  const proj = projectUri(state);
  const existing = store.statementsMatching(proj, RDF('type'), MINERVA('Project'));
  if (existing.length === 0) {
    store.add(proj, RDF('type'), MINERVA('Project'));
    store.add(proj, DC('title'), $rdf.lit(path.basename(rootPath)));
  }
}

/**
 * Statements describing every `thought:Proposal` in the store. Proposals are the
 * review queue's source of truth and are NOT rebuilt from notes, so a
 * from-scratch reindex must carry them across the reset — otherwise the queue
 * empties on every rebuild and a CLI/MCP-filed proposal (persisted in graph.ttl)
 * would be dropped the moment the app next indexes, before the user ever sees it
 * (#1151, epic #1145 — substrate/fleet provenance).
 */
function captureProposalStatements(store: $rdf.IndexedFormula): $rdf.Statement[] {
  const out: $rdf.Statement[] = [];
  for (const typed of store.statementsMatching(undefined, RDF('type'), THOUGHT('Proposal'))) {
    // Proposals are flat records — every triple on the proposal subject.
    out.push(...store.statementsMatching(typed.subject, undefined, undefined));
  }
  return out;
}

/**
 * Rewrite a term whose IRI/literal carries the old base to the new base
 * (#1443 Part B — rewrite-on-rebase). NamedNodes under `from` are re-pointed;
 * literals containing `from` (the proposal's `thought:payloadJson`, which
 * embeds base IRIs in its turtle) get every occurrence replaced. The base is a
 * unique URL prefix, so this can't touch the fixed `minerva:`/`thought:`/`prov:`
 * ontology namespaces. Other terms pass through untouched.
 */
function rebaseTerm(term: $rdf.Node, from: string, to: string): $rdf.Node {
  if (term.termType === 'NamedNode' && term.value.startsWith(from)) {
    return $rdf.sym(to + term.value.slice(from.length));
  }
  if (term.termType === 'Literal' && term.value.includes(from)) {
    const lit = term as $rdf.Literal;
    return $rdf.literal(lit.value.split(from).join(to), lit.language || lit.datatype);
  }
  return term;
}

function restoreProposalStatements(
  store: $rdf.IndexedFormula,
  stmts: $rdf.Statement[],
  rebase?: { from: string; to: string },
): void {
  for (const st of stmts) {
    if (rebase) {
      // Predicates are ontology terms (never base-derived), so leave them.
      store.add(
        rebaseTerm(st.subject, rebase.from, rebase.to) as $rdf.NamedNode,
        st.predicate,
        rebaseTerm(st.object as $rdf.Node, rebase.from, rebase.to),
      );
    } else {
      store.add(st.subject, st.predicate, st.object);
    }
  }
}

/**
 * `rebaseFrom` (#1443 Part B): the previous base IRI when this rebuild is a
 * rebase. Pending/approved proposals aren't re-derivable from files, so they're
 * carried across the reset — and, when rebasing, their base-prefixed IRIs +
 * payload turtle are rewritten to the (already-updated) `state.baseUri` so they
 * neither dangle on apply nor break the trust-integrity join for approved ones.
 */
export interface IndexAllNotesOptions {
  rebaseFrom?: string;
  /**
   * Determinate progress for a user-visible rebuild (#1814). Called once per
   * note during the main pass; `total` comes from the alias pre-pass, which
   * has already walked the whole tree, so it costs nothing extra to know.
   */
  onProgress?: (done: number, total: number) => void;
}

export async function indexAllNotes(ctx: ProjectContext, opts?: IndexAllNotesOptions): Promise<number> {
  const state = getState(ctx);
  if (!state) return 0;
  const { rootPath } = state;

  // Carry proposals across the from-scratch reset below (see the helper's note).
  const preservedProposals = captureProposalStatements(state.store);
  const rebase = opts?.rebaseFrom && opts.rebaseFrom !== state.baseUri
    ? { from: opts.rebaseFrom, to: state.baseUri }
    : undefined;

  // Reset and rebuild from scratch with ontology. The wholesale store swap is
  // the one mutation the incremental N3 mirror can't track, so drop the mirror
  // (rebuilt lazily on the next query) and re-instrument the fresh store (#1110).
  state.store = $rdf.graph();
  instrumentStoreMirror(state);
  resetN3Mirror(state);
  invalidate(state);
  addOntologyToStore(state);
  state.aliasesPerNote.clear();
  state.aliasMap.clear();
  state.indexedNotePaths.clear();

  ensureProject(state);
  restoreProposalStatements(state.store, preservedProposals, rebase);

  // Typed objects (#1062): load this project's type catalog (stock + in-tree
  // user types) and materialize the classes into the fresh store, so notes'
  // `type:` frontmatter can resolve to a registered class below and the graph
  // knows the classes exist. Reloaded on every full rebuild.
  state.typeCatalog = await loadTypeCatalog(rootPath);
  materializeTypeClasses(state.store, state.typeCatalog);

  // Two-pass build (#469): the first walk just reads frontmatter
  // aliases so the alias map is fully populated before any link gets
  // resolved. Otherwise notes indexed early would resolve `[[alias]]`
  // against an empty map and write the wrong target URI.
  let total = 0;
  await walkAndCollectAliases(rootPath, rootPath);
  rebuildAliasMap(state);

  // Build the wiki-link resolver index ONCE — indexedNotePaths + the alias map
  // are final after the pre-pass — and thread it into every indexNote below, so
  // link resolution across the whole pass is O(N), not O(N²) (#1473).
  const passLinkCtx = buildLinkResolveCtx(state);

  let count = 0;
  await walkAndIndex(rootPath, rootPath);
  // Each indexNote call above skipped its own rebuild (perf #1106) — the
  // pre-pass already left aliasMap correct, but rebuild once more here as a
  // cheap (O(N), not O(N²)) guarantee rather than relying on the pre-pass
  // and the main pass never diverging.
  rebuildAliasMap(state);
  count += await walkAndIndexSources(ctx, rootPath);
  count += await walkAndIndexExcerpts(ctx, rootPath);
  // graph.ttl is a cold snapshot now (#348). The release / quit path
  // writes the snapshot; an in-app rebuild only mutates the live store.

  async function walkAndIndex(dirPath: string, root: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const rel = path.relative(root, fullPath);
        ensureFolder(state!, rel);
        await walkAndIndex(fullPath, root);
      } else if (isIndexable(entry.name)) {
        const relativePath = path.relative(root, fullPath);
        const content = await fs.readFile(fullPath, 'utf-8');
        await indexNote(ctx, relativePath, content, { skipAliasRebuild: true, linkCtx: passLinkCtx });
        count++;
        opts?.onProgress?.(count, total);
      }
    }
  }

  async function walkAndCollectAliases(dirPath: string, root: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walkAndCollectAliases(fullPath, root);
      } else if (isIndexable(entry.name)) {
        const relativePath = path.relative(root, fullPath);
        // Register every note path up front so the main pass resolves bare
        // `[[basename]]` links against the COMPLETE file set — otherwise a note
        // indexed early couldn't resolve a link to one indexed later (#1142).
        // Mirrors the alias pre-pass rationale (#469). All note extensions, so
        // `[[budget]]` resolves to a `budget.csv`/`.ttl`/`.py` too (#1446).
        state!.indexedNotePaths.add(relativePath);
        // The pre-pass visits exactly what the main pass will index, so it
        // doubles as the count a progress bar needs (#1814).
        total++;
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const parsed = parseMarkdown(content);
          const valid = parsed.aliases.filter(isAliasNameValid);
          if (valid.length > 0) state!.aliasesPerNote.set(relativePath, valid);
        } catch {
          // Skip unreadable files; the main pass will surface the same error.
        }
      }
    }
  }

  return count;
}


