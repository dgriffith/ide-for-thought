/**
 * Note indexing (#1624/#1905 split by format out of indexers.ts; this file is
 * what's left after those extractions and #2050's facade split).
 *
 * `indexNote`/`removeNote` are the entry points every note write goes
 * through, regardless of format — `.ttl`/`.csv`/`.py` dispatch immediately to
 * their format-specific indexers in `./note-files`/`./tables`; everything
 * past that early-return is markdown-note-specific: frontmatter, tags, wiki
 * links, aliases, and heading-rename detection. `rebuildAliasMap` is the
 * shared alias-resolution machinery both this file's incremental path and
 * `./rebuild`'s full-tree pre-pass call.
 */

import * as $rdf from 'rdflib';
import path from 'node:path';
import { parseMarkdown } from '../parser';
import { getLinkType } from '../../../shared/link-types';
import { stripNoteExt } from '../../../shared/note-extensions';
import { slugify } from '../../../shared/slug';
import { logger } from '../../../shared/logger';

import type { ProjectContext } from '../../project-context-types';

import {
  type GraphState, type HeadingSnapshot,
  getState, invalidate,
  MINERVA, DC, RDF, TYPES,
  noteUri, tagUri, folderUri, projectUri,
  linkPredicate, dateLit,
} from '../state';
import type { PropertyType } from '../../../shared/objects/type-def';

import { checkLLMWriteGuard } from '../write-guard';
import {
  fileMtimeIso, injectPrefixes,
  ensureTag, ensureFolder, flattenFrontmatterStrings,
  buildLinkResolveCtx, resolveLinkTarget, type LinkResolveCtx,
} from '../index-helpers';
import { indexTurtleFile, indexCsvFile, indexPythonFile } from './note-files';
import { indexTable } from './tables';

// `findNotesLinkingToAnchorImpl` is a queries-layer helper; detectHeadingRename
// (an indexer-only helper below) reuses it.
import { findNotesLinkingToAnchorImpl } from '../queries';

import { emitFrontmatterValue, declaredPropertyPredicate } from './frontmatter';
import { emitGraphChanged } from '../graph-events';

/**
 * Aliases that contain wiki-link metacharacters can't be expressed as
 * `[[alias]]` and so couldn't be resolved anyway. Reject them with a
 * one-line console warning instead of crashing or silently misindexing.
 */
const INVALID_ALIAS_CHAR = /[[\]|#\n]/;

export function isAliasNameValid(name: string): boolean {
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
export function rebuildAliasMap(state: GraphState): void {
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

// ── Heading snapshots ────────────────────────────────────────────────────
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

// ── Indexing ──────────────────────────────────────────────────────────────

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
