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
import fsSync from 'node:fs';
import path from 'node:path';
import { parseMarkdown, type ParsedTable, type FrontmatterValue } from './parser';
import { getLinkType, type LinkType } from '../../shared/link-types';
import { mapFrontmatterKey, type FrontmatterPredicate } from './frontmatter-predicates';
import { slugify } from '../../shared/slug';
import { parseCsv } from '../../shared/csv-parse';
import { isIndexable } from '../notebase/indexable-files';
import * as uriHelpers from './uri-helpers';

import type { ProjectContext } from '../project-context-types';

import {
  type GraphState, type HeadingSnapshot,
  getState, invalidate,
  MINERVA, DC, RDF, RDFS, XSD, CSVW, OWL, BIBO, SCHEMA, PROV, THOUGHT,
  STANDARD_PREFIXES,
  noteUri, tagUri, folderUri, sourceUri, excerptUri, tableUri, projectUri,
  linkPredicate, dateLit,
} from './state';

import { checkLLMWriteGuard } from './write-guard';

// `findNotesLinkingToAnchorImpl` is a queries-layer helper; detectHeadingRename
// (an indexer-only helper below) reuses it.
import { findNotesLinkingToAnchorImpl } from './queries';

// ── URI helpers ─────────────────────────────────────────────────────────────
// The state-taking URI helpers (noteUri, tagUri, folderUri, sourceUri,
// excerptUri, tableUri, projectUri, linkPredicate) live in ./state and are
// imported above; the link-resolution helpers that are indexer-only stay here.

function resolveLinkTarget(state: GraphState, lt: LinkType, target: string, anchor?: string) {
  if (lt.targetKind === 'source') return sourceUri(state, target);
  if (lt.targetKind === 'excerpt') return excerptUri(state, target);
  const resolvedPath = resolveTargetByAlias(state, target);
  const base = noteUri(state, resolvedPath.endsWith('.md') ? resolvedPath : `${resolvedPath}.md`);
  // Anchors append as an IRI fragment: headings become `#slug`, block-ids
  // stay as `#^raw-id` (we don't slugify the `^` prefix or its payload so
  // ids survive edits on the referenced block).
  if (!anchor) return base;
  const frag = anchor.startsWith('^') ? anchor : slugify(anchor);
  return $rdf.sym(`${base.value}#${frag}`);
}

/**
 * If the wiki-link target name resolves via the alias map, return the
 * underlying note's relativePath (without `.md`). Otherwise return
 * `target` unchanged. Filename / title matches always win over aliases
 * (#469); the map's `rebuildAliasMap` step drops alias entries that
 * collide with canonical names so this lookup is safe.
 */
function resolveTargetByAlias(state: GraphState, target: string): string {
  // The map keys store the alias verbatim (case-insensitive lookup
  // happens via .toLowerCase). Targets with anchors / `.md` suffix are
  // handled by the caller — this helper only sees the bare path part.
  const key = target.toLowerCase();
  const aliased = state.aliasMap.get(key);
  if (!aliased) return target;
  // Strip `.md` so the caller's append logic stays simple.
  return aliased.replace(/\.md$/i, '');
}

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
    const stem = path.replace(/\.md$/i, '').toLowerCase();
    next.delete(stem);
    const basename = stem.split('/').pop() ?? '';
    if (basename) next.delete(basename);
  }
  state.aliasMap = next;
}

// ── Frontmatter helpers ─────────────────────────────────────────────────────

/** Flatten a frontmatter value to a list of strings — for multi-valued string keys like tags. */
function flattenFrontmatterStrings(value: FrontmatterValue): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flattenFrontmatterStrings);
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (value instanceof Date) return [value.toISOString()];
  return [];
}

type FrontmatterScalarNonNull = Exclude<FrontmatterValue, null | FrontmatterValue[]>;

/**
 * Reconstitute YAML-eaten wiki-link shorthand. The user writes
 *
 *   about: [[sources/foo]]
 *
 * intending a wiki-link, but YAML's flow syntax interprets the outer
 * `[…]` as an array literal and the inner `[…]` as a nested array,
 * yielding `[['sources/foo']]`. The brackets the user typed are gone
 * by the time we see the value.
 *
 * The narrow signature `[[<single string>]]` is unambiguous —
 * authentic length-1 arrays of length-1 arrays of strings don't
 * occur in normal frontmatter. Translate that one shape back into
 * the wiki-link form a downstream consumer expects. Anything more
 * complex (multi-element inner array, mixed types) is left alone —
 * users who need lists should use the proper YAML list form anyway.
 */
function recoverYamlEatenWikiLink(value: FrontmatterValue): FrontmatterValue {
  if (
    Array.isArray(value)
    && value.length === 1
    && Array.isArray(value[0])
    && value[0].length === 1
    && typeof value[0][0] === 'string'
  ) {
    return `[[${value[0][0]}]]`;
  }
  return value;
}

/** Flatten nested arrays, dropping nulls. Scalars pass through in typed form. */
function flattenFrontmatterScalars(value: FrontmatterValue): FrontmatterScalarNonNull[] {
  const recovered = recoverYamlEatenWikiLink(value);
  if (recovered === null || recovered === undefined) return [];
  if (Array.isArray(recovered)) return recovered.flatMap(flattenFrontmatterScalars);
  return [recovered];
}

function resolveFrontmatterPredicate(key: string) {
  const mapped: FrontmatterPredicate | null = mapFrontmatterKey(key);
  if (!mapped) return MINERVA(`meta-${key}`);
  switch (mapped.ns) {
    case 'dc': return DC(mapped.local);
    case 'bibo': return BIBO(mapped.local);
    case 'schema': return SCHEMA(mapped.local);
    case 'thought': return THOUGHT(mapped.local);
    case 'prov': return PROV(mapped.local);
  }
}

/** Match [[target]] or [[target|display]] (no typed-link prefix — values are bare refs). */
const FRONTMATTER_WIKILINK_RE = /^\[\[([^[\]\n|]+)(?:\|[^\]]+)?\]\]$/;

/**
 * Turn a typed frontmatter scalar into an rdflib term.
 * - `"[[notes/foo]]"` → note URI (so backlinks work)
 * - `42`              → xsd:integer literal
 * - `3.14`            → xsd:decimal literal
 * - `true`/`false`    → xsd:boolean literal
 * - `Date`            → xsd:dateTime literal
 * - `"2024-01-15"`    → xsd:date literal (ISO-date shape)
 * - other string      → plain string literal
 */
function frontmatterValueToTerm(value: Exclude<FrontmatterValue, null | FrontmatterValue[]>, projectBaseUri: string) {
  if (value instanceof Date) {
    return $rdf.lit(value.toISOString(), undefined, XSD('dateTime'));
  }
  if (typeof value === 'boolean') {
    return $rdf.lit(String(value), undefined, XSD('boolean'));
  }
  if (typeof value === 'number') {
    const datatype = Number.isInteger(value) ? 'integer' : 'decimal';
    return $rdf.lit(String(value), undefined, XSD(datatype));
  }
  // Strings: try wiki-link first, then date shapes, then plain.
  const wiki = value.match(FRONTMATTER_WIKILINK_RE);
  if (wiki && projectBaseUri) {
    const target = wiki[1].trim();
    // `[[sources/<id>]]` materialises as the actual source URI rather
    // than a phantom note path (#474). Lets `about: [[sources/foo]]`
    // become a real edge from this note to the foo source, queryable
    // alongside the cite/quote backlinks the source detail collects.
    if (target.startsWith('sources/')) {
      const sourceId = target.slice('sources/'.length);
      if (sourceId) return $rdf.sym(uriHelpers.sourceUri(projectBaseUri, sourceId));
    }
    const noteRel = target.endsWith('.md') ? target : `${target}.md`;
    return $rdf.sym(uriHelpers.noteUri(projectBaseUri, noteRel));
  }
  // Bare absolute URI → IRI node. Lets a frontmatter key like
  // `supports: https://minerva.dev/c/claim-…` materialise as a real
  // graph edge to that node, rather than as an opaque string literal.
  // The tail check excludes whitespace so we don't mis-classify a
  // longer string that happens to start with a URL.
  if (/^https?:\/\/\S+$/.test(value)) {
    return $rdf.sym(value);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return $rdf.lit(value, undefined, XSD('date'));
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return $rdf.lit(value, undefined, XSD('dateTime'));
  }
  if (/^\d{4}$/.test(value)) {
    return $rdf.lit(value, undefined, XSD('gYear'));
  }
  return $rdf.lit(value);
}

/**
 * `dc:modified` should reflect the user's last edit, not the indexer's
 * last sweep — otherwise checkStaleness sees every note as just-modified
 * and is always-empty theatre (#336). Read mtime from disk; fall back to
 * `now` only when the file is gone (mid-rename race) so the triple is
 * still well-formed.
 */
function fileMtimeIso(state: GraphState, relativePath: string): string {
  try {
    return fsSync.statSync(path.join(state.rootPath, relativePath)).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function injectPrefixes(state: GraphState, turtle: string, noteIri: string): string {
  const lines: string[] = [];
  for (const [prefix, iri] of STANDARD_PREFIXES) {
    if (!turtle.includes(`@prefix ${prefix}:`)) {
      lines.push(`@prefix ${prefix}: <${iri}> .`);
    }
  }
  // Project-scoped shortcuts for referring to other sources/excerpts in
  // this thoughtbase by bare id: `sources:smith-2023`, `excerpts:p42`.
  if (state.baseUri) {
    if (!turtle.includes('@prefix sources:')) {
      lines.push(`@prefix sources: <${state.baseUri}source/> .`);
    }
    if (!turtle.includes('@prefix excerpts:')) {
      lines.push(`@prefix excerpts: <${state.baseUri}excerpt/> .`);
    }
  }
  if (!turtle.includes('@prefix this:')) {
    lines.push(`@prefix this: <${noteIri}> .`);
  }
  lines.push('');
  return lines.join('\n') + turtle;
}

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
    const text = m[2].trim();
    const slug = slugify(text);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    out.push({ slug, text, level: m[1].length });
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

// indexNote is an async-by-contract public API: callers `await` it across
// the project (ipc, write-pipeline, watchers, rename), and we want the
// freedom to add real async work later without rippling out a signature
// change. The current body happens to be sync.
// eslint-disable-next-line @typescript-eslint/require-await
export async function indexNote(
  ctx: ProjectContext,
  relativePath: string,
  content: string,
): Promise<{ headingRenameCandidate?: HeadingRenameCandidate }> {
  checkLLMWriteGuard('indexNote');
  const state = getState(ctx);
  if (!state) return {};
  // Any successful exit through this function has mutated the rdflib
  // store; flag the N3 mirror as stale once, at the boundary, instead
  // of after every internal store.add.
  invalidate(state);
  const { store, baseUri, headingsPerNote } = state;

  const subject = noteUri(state, relativePath);
  const graph = subject; // named graph = note URI, for clean removal on re-index

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

  // Type
  store.add(subject, RDF('type'), MINERVA('Note'), graph);

  // Parse markdown
  const parsed = parseMarkdown(content);

  // Snapshot frontmatter keys for the Properties panel's project-wide
  // autocomplete (#488). Captured before the per-key indexing loop
  // below so we record every key the user actually typed, including
  // `title` and `tags` (skipped by the predicate-mapping path because
  // they're already wired through other paths).
  state.frontmatterKeysPerNote.set(relativePath, Object.keys(parsed.frontmatter));

  // Title
  const title = parsed.title ?? path.basename(relativePath, '.md');
  store.add(subject, DC('title'), $rdf.lit(title), graph);

  // File info
  store.add(subject, MINERVA('filename'), $rdf.lit(path.basename(relativePath)), graph);
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath), graph);

  // Timestamps — dc:modified is the user's last edit, sourced from
  // disk mtime, not the indexer's wall clock (#336).
  store.add(subject, DC('modified'), dateLit(fileMtimeIso(state, relativePath)), graph);

  // Folder membership
  const dir = path.dirname(relativePath);
  if (dir && dir !== '.') {
    store.add(subject, MINERVA('inFolder'), folderUri(state, dir), graph);
    ensureFolder(state, dir);
  }

  // Project membership
  store.add(projectUri(state), MINERVA('containsNote'), subject, graph);

  // Tags — modeled as resources. Body tags (#foo) are already in parsed.tags;
  // add frontmatter `tags: [foo, bar]` on top (they're not added to parsed.tags
  // so a tag that only appears in frontmatter still gets indexed here).
  const bodyTags = new Set(parsed.tags);
  const fmTagValue = parsed.frontmatter.tags;
  if (fmTagValue !== undefined) {
    for (const t of flattenFrontmatterStrings(fmTagValue)) {
      if (t) bodyTags.add(t);
    }
  }
  for (const tag of bodyTags) {
    const tagNode = tagUri(state, tag);
    ensureTag(state, tagNode, tag);
    store.add(subject, MINERVA('hasTag'), tagNode, graph);
  }

  // Frontmatter aliases (#469). Track per-note so the next reindex of
  // this same note can drop stale aliases; rebuild the resolver map
  // so subsequent link resolution sees current state. Aliases that
  // contain wiki-link metacharacters (`[`, `]`, `|`, `#`, `\n`) are
  // dropped — they couldn't be expressed as `[[alias]]` anyway.
  state.indexedNotePaths.add(relativePath);
  const validAliases = parsed.aliases.filter(isAliasNameValid);
  if (validAliases.length > 0) {
    state.aliasesPerNote.set(relativePath, validAliases);
  } else {
    state.aliasesPerNote.delete(relativePath);
  }
  rebuildAliasMap(state);
  for (const alias of validAliases) {
    store.add(subject, MINERVA('hasAlias'), $rdf.lit(alias), graph);
  }

  // Wiki-links — typed predicates
  for (const link of parsed.links) {
    const linkType = getLinkType(link.type);
    const predicate = linkPredicate(linkType);
    const targetNode = resolveLinkTarget(state, linkType, link.target, link.anchor);
    store.add(subject, predicate, targetNode, graph);
  }

  // Frontmatter → triples. `title` (already used as the note title) and
  // `tags` (handled above) are skipped here so they don't double-emit.
  for (const [key, value] of Object.entries(parsed.frontmatter)) {
    if (key === 'title' || key === 'tags') continue;
    const predicate = resolveFrontmatterPredicate(key);
    for (const v of flattenFrontmatterScalars(value)) {
      const term = frontmatterValueToTerm(v, baseUri);
      if (term) store.add(subject, predicate, term, graph);
    }
  }

  // Embedded turtle blocks — parse into the note's named graph
  for (const block of parsed.turtleBlocks) {
    try {
      const prefixed = injectPrefixes(state, block, subject.value);
      $rdf.parse(prefixed, store, graph.value, 'text/turtle');
    } catch (e) {
      console.error(`[minerva] Failed to parse turtle block in ${relativePath}:`, e instanceof Error ? e.message : e);
    }
  }

  // Markdown tables — CSVW triples
  for (let ti = 0; ti < parsed.tables.length; ti++) {
    indexTable(state, parsed.tables[ti], ti, subject, graph);
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

  const old = removed[0];
  const fresh = added[0];
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

function indexTable(
  state: GraphState,
  table: ParsedTable,
  tableIndex: number,
  noteNode: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  const { store } = state;

  const tableUri = $rdf.sym(`${noteNode.value}/table/${tableIndex}`);
  store.add(tableUri, RDF('type'), CSVW('Table'), graph);
  store.add(tableUri, CSVW('inNote'), noteNode, graph);

  // Columns
  const colNodes: $rdf.NamedNode[] = [];
  for (let ci = 0; ci < table.headers.length; ci++) {
    const colName = table.headers[ci];
    const colUri = $rdf.sym(`${tableUri.value}/column/${encodeURIComponent(colName)}`);
    colNodes.push(colUri);
    store.add(colUri, RDF('type'), CSVW('Column'), graph);
    store.add(colUri, CSVW('name'), $rdf.lit(colName), graph);
    store.add(colUri, CSVW('columnIndex'), $rdf.lit(String(ci), undefined, XSD('integer')), graph);
    store.add(tableUri, CSVW('column'), colUri, graph);
  }

  // Rows and cells
  for (let ri = 0; ri < table.rows.length; ri++) {
    const rowUri = $rdf.sym(`${tableUri.value}/row/${ri}`);
    store.add(rowUri, RDF('type'), CSVW('Row'), graph);
    store.add(rowUri, CSVW('rowIndex'), $rdf.lit(String(ri), undefined, XSD('integer')), graph);
    store.add(tableUri, CSVW('row'), rowUri, graph);

    for (let ci = 0; ci < table.headers.length; ci++) {
      const value = table.rows[ri][ci] ?? '';
      const cellUri = $rdf.sym(`${rowUri.value}/cell/${encodeURIComponent(table.headers[ci])}`);
      store.add(cellUri, RDF('type'), CSVW('Cell'), graph);
      store.add(cellUri, CSVW('column'), colNodes[ci], graph);
      store.add(cellUri, RDF('value'), $rdf.lit(value), graph);
      store.add(rowUri, CSVW('cell'), cellUri, graph);
    }
  }
}

// ── CSV-as-DuckDB table indexing ────────────────────────────────────────────

/**
 * Shape of a registered CSV table column, passed in from the DuckDB side.
 * `duckdbType` comes from `information_schema.columns` (VARCHAR, INTEGER,
 * DOUBLE, TIMESTAMP, …). We map it to an xsd datatype so SPARQL consumers
 * can reason about ranges.
 */
export interface CsvTableColumn {
  name: string;
  duckdbType: string;
  index: number;
}

export interface CsvTableShape {
  tableName: string;
  relativePath: string;
  columns: CsvTableColumn[];
}

/**
 * Crude DuckDB type → XSD datatype mapping. DuckDB's type vocabulary is
 * richer than xsd's — e.g. HUGEINT, UUID, INTERVAL — so we keep the map
 * conservative and fall back to xsd:string when nothing else fits. The
 * goal is "a SPARQL consumer can filter by range", not "round-trip every
 * DuckDB value losslessly".
 */
function xsdForDuckDbType(duckdbType: string) {
  const t = duckdbType.toUpperCase();
  if (t === 'BOOLEAN') return XSD('boolean');
  if (t === 'DATE') return XSD('date');
  if (t === 'TIME') return XSD('time');
  if (t.startsWith('TIMESTAMP')) return XSD('dateTime');
  if (t === 'FLOAT' || t === 'REAL') return XSD('float');
  if (t === 'DOUBLE') return XSD('double');
  if (t.startsWith('DECIMAL') || t === 'NUMERIC') return XSD('decimal');
  if (t === 'TINYINT' || t === 'SMALLINT' || t === 'INTEGER' || t === 'BIGINT' || t === 'HUGEINT') {
    return XSD('integer');
  }
  if (t === 'UTINYINT' || t === 'USMALLINT' || t === 'UINTEGER' || t === 'UBIGINT') {
    return XSD('nonNegativeInteger');
  }
  // VARCHAR / TEXT / BLOB / UUID / INTERVAL / LIST / STRUCT / … all fall
  // through to string. Users who need finer typing can refine via a
  // companion note's frontmatter in a later pass.
  return XSD('string');
}

/**
 * Write CSVW + OWL triples describing a registered CSV table. The named
 * graph equals the table URI so re-indexing is a clean wipe-and-replace,
 * same pattern as notes.
 *
 * - `csvw:Table` + `owl:Class` on the table (rows are its instances).
 * - `csvw:Schema` with ordered `csvw:column` references.
 * - Each column is both a `csvw:Column` (index, name, datatype) and an
 *   `owl:DatatypeProperty` (rdfs:domain = table, rdfs:range = xsd type)
 *   so SPARQL queries can reason about columns-as-predicates.
 */
export function indexCsvTable(ctx: ProjectContext, shape: CsvTableShape): void {
  checkLLMWriteGuard('indexCsvTable');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const { store } = state;
  const table = tableUri(state, shape.tableName);
  const graph = table;
  const schema = $rdf.sym(`${table.value}/schema`);

  // Clean slate for this table's triples.
  store.removeMatches(undefined, undefined, undefined, graph);

  store.add(table, RDF('type'), CSVW('Table'), graph);
  store.add(table, RDF('type'), OWL('Class'), graph);
  store.add(table, RDFS('label'), $rdf.lit(shape.tableName), graph);
  store.add(table, CSVW('url'), $rdf.lit(shape.relativePath), graph);
  store.add(table, CSVW('tableSchema'), schema, graph);
  store.add(table, MINERVA('tableName'), $rdf.lit(shape.tableName), graph);
  store.add(table, MINERVA('relativePath'), $rdf.lit(shape.relativePath), graph);
  // Join-back link to the CSV file's own note-URI, so SPARQL can pivot
  // between the file-level view (row data, written by indexCsvFile)
  // and this SQL-centric view (named table, typed columns, OWL class).
  store.add(table, MINERVA('fromFile'), noteUri(state, shape.relativePath), graph);

  store.add(schema, RDF('type'), CSVW('Schema'), graph);

  for (const col of shape.columns) {
    const colUri = $rdf.sym(`${table.value}/column/${encodeURIComponent(col.name)}`);
    const xsdType = xsdForDuckDbType(col.duckdbType);
    store.add(schema, CSVW('column'), colUri, graph);
    store.add(colUri, RDF('type'), CSVW('Column'), graph);
    store.add(colUri, RDF('type'), OWL('DatatypeProperty'), graph);
    store.add(colUri, CSVW('name'), $rdf.lit(col.name), graph);
    store.add(colUri, CSVW('columnIndex'), $rdf.lit(String(col.index), undefined, XSD('integer')), graph);
    store.add(colUri, CSVW('datatype'), xsdType, graph);
    store.add(colUri, RDFS('label'), $rdf.lit(col.name), graph);
    store.add(colUri, RDFS('domain'), table, graph);
    store.add(colUri, RDFS('range'), xsdType, graph);
  }
}

/** Remove all triples for a CSV table (entire named graph). */
export function unindexCsvTable(ctx: ProjectContext, tableName: string): void {
  checkLLMWriteGuard('unindexCsvTable');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const graph = tableUri(state, tableName);
  state.store.removeMatches(undefined, undefined, undefined, graph);
}

/**
 * Drop every CSV-registered table's triples. Used at the start of a
 * full rescan so triples for CSVs deleted while the app was closed
 * don't persist. Identifies them via `minerva:tableName`, which
 * markdown-embedded csvw:Table nodes don't carry — those stay.
 */
export function unindexAllCsvTables(ctx: ProjectContext): void {
  checkLLMWriteGuard('unindexAllCsvTables');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const { store } = state;
  // Snapshot subjects before removing — rdflib's statementsMatching
  // returns a live reference into the store, so removing triples while
  // iterating drops subsequent matches.
  const subjects: $rdf.NamedNode[] = [];
  const seen = new Set<string>();
  for (const st of store.statementsMatching(undefined, MINERVA('tableName'), undefined)) {
    if (seen.has(st.subject.value)) continue;
    seen.add(st.subject.value);
    subjects.push(st.subject as $rdf.NamedNode);
  }
  for (const s of subjects) {
    store.removeMatches(undefined, undefined, undefined, s);
  }
}

/**
 * Index a standalone `.py` file. Python helpers in the notebase are
 * importable from ```python cells (the kernel puts the project root on
 * `sys.path`). We emit minimal metadata so the file appears in note
 * listings, sidebar tag queries, and "everything in folder X" graph
 * queries — no AST parsing, no symbol extraction (the kernel itself
 * is the source of truth for what a module exposes).
 *
 * `minerva:PythonModule rdfs:subClassOf minerva:Note`, so existing
 * "list every note" queries pick these up too; a more specific
 * "list every Python module" query can use the subclass directly.
 */
function indexPythonFile(
  state: GraphState,
  relativePath: string,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  const { store } = state;

  store.add(subject, RDF('type'), MINERVA('Note'), graph);
  store.add(subject, RDF('type'), MINERVA('PythonModule'), graph);
  const title = path.basename(relativePath, '.py');
  store.add(subject, DC('title'), $rdf.lit(title), graph);
  store.add(subject, MINERVA('filename'), $rdf.lit(path.basename(relativePath)), graph);
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath), graph);
  store.add(subject, DC('modified'), dateLit(fileMtimeIso(state, relativePath)), graph);

  const dir = path.dirname(relativePath);
  if (dir && dir !== '.') {
    store.add(subject, MINERVA('inFolder'), folderUri(state, dir), graph);
    ensureFolder(state, dir);
  }
  store.add(projectUri(state), MINERVA('containsNote'), subject, graph);
}

function indexTurtleFile(
  state: GraphState,
  relativePath: string,
  content: string,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  const { store } = state;

  // Basic file metadata
  store.add(subject, RDF('type'), MINERVA('Note'), graph);
  const title = path.basename(relativePath, '.ttl');
  store.add(subject, DC('title'), $rdf.lit(title), graph);
  store.add(subject, MINERVA('filename'), $rdf.lit(path.basename(relativePath)), graph);
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath), graph);
  store.add(subject, DC('modified'), dateLit(fileMtimeIso(state, relativePath)), graph);

  // Folder membership
  const dir = path.dirname(relativePath);
  if (dir && dir !== '.') {
    store.add(subject, MINERVA('inFolder'), folderUri(state, dir), graph);
    ensureFolder(state, dir);
  }

  // Project membership
  store.add(projectUri(state), MINERVA('containsNote'), subject, graph);

  // Parse the entire file as Turtle into the note's named graph
  try {
    const prefixed = injectPrefixes(state, content, subject.value);
    $rdf.parse(prefixed, store, graph.value, 'text/turtle');
  } catch (e) {
    console.error(`[minerva] Failed to parse turtle file ${relativePath}:`, e instanceof Error ? e.message : e);
  }
}

/**
 * Index a standalone `.csv` file (#199). Mirrors indexTurtleFile’s
 * note-metadata setup, then parses the file as CSV and emits CSVW
 * triples. The file’s subject IS the Table (`rdf:type csvw:Table`),
 * with `csvw:inFile <relativePath>` for symmetry with the markdown-
 * table indexer’s `csvw:inNote`.
 */
function indexCsvFile(
  state: GraphState,
  relativePath: string,
  content: string,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  const { store } = state;

  // Note-style metadata so the file shows up in listings / tag queries / etc.
  store.add(subject, RDF('type'), MINERVA('Note'), graph);
  const title = path.basename(relativePath, '.csv');
  store.add(subject, DC('title'), $rdf.lit(title), graph);
  store.add(subject, MINERVA('filename'), $rdf.lit(path.basename(relativePath)), graph);
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath), graph);
  store.add(subject, DC('modified'), dateLit(fileMtimeIso(state, relativePath)), graph);

  const dir = path.dirname(relativePath);
  if (dir && dir !== '.') {
    store.add(subject, MINERVA('inFolder'), folderUri(state, dir), graph);
    ensureFolder(state, dir);
  }
  store.add(projectUri(state), MINERVA('containsNote'), subject, graph);

  // CSVW: the file IS the Table. One file → one table.
  store.add(subject, RDF('type'), CSVW('Table'), graph);
  store.add(subject, CSVW('inFile'), $rdf.lit(relativePath), graph);

  const parsed = parseCsv(content);
  if (parsed.headers.length === 0) return;

  // Columns — the table's schema (header name + zero-based index). One triple-
  // cluster per header, so the cost is bounded by column count.
  //
  // We deliberately do NOT emit per-cell `csvw:Cell` / `csvw:Row` triples (#337).
  // A 10k-row × 100-col CSV produced ~4M triples in the in-memory store, and
  // nothing queried cell *values* over the graph — cell-level querying is the
  // DuckDB / SQL path's job (`indexCsvTable`, joinable back to this file via
  // `minerva:fromFile`). Keeping just the Table + column schema is enough for
  // the sidebar / tag / schema queries that touch CSV files through the graph.
  for (let ci = 0; ci < parsed.headers.length; ci++) {
    const colName = parsed.headers[ci];
    const colUri = $rdf.sym(`${subject.value}/column/${encodeURIComponent(colName)}`);
    store.add(colUri, RDF('type'), CSVW('Column'), graph);
    store.add(colUri, CSVW('name'), $rdf.lit(colName), graph);
    store.add(colUri, CSVW('columnIndex'), $rdf.lit(String(ci), undefined, XSD('integer')), graph);
    store.add(subject, CSVW('column'), colUri, graph);
  }
}

export function removeNote(ctx: ProjectContext, relativePath: string): void {
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

// ── Source indexing ─────────────────────────────────────────────────────────
// A "source" is a citable external work (Article, Book, WebPage, …) whose
// canonical metadata lives at .minerva/sources/<id>/meta.ttl. The source
// node's URI is `${baseUri}source/<id>`; inside meta.ttl, `this:` resolves
// to that URI so users can write `this: a thought:Article ; dc:title ...`.

export function indexSource(ctx: ProjectContext, sourceId: string, metaTtl: string, bodyMd?: string): void {
  checkLLMWriteGuard('indexSource');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const { store } = state;

  const subject = sourceUri(state, sourceId);
  const graph = subject;
  const relativePath = `${uriHelpers.SOURCES_DIR}/${sourceId}/meta.ttl`;

  store.removeMatches(undefined, undefined, undefined, graph);
  store.removeMatches(subject, undefined, undefined);

  store.add(subject, MINERVA('sourceId'), $rdf.lit(sourceId), graph);
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath), graph);
  store.add(subject, DC('modified'), dateLit(fileMtimeIso(state, relativePath)), graph);
  store.add(projectUri(state), MINERVA('containsSource'), subject, graph);

  try {
    const prefixed = injectPrefixes(state, metaTtl, subject.value);
    $rdf.parse(prefixed, store, graph.value, 'text/turtle');
  } catch (e) {
    console.error(`[minerva] Failed to parse source meta.ttl for ${sourceId}:`, e instanceof Error ? e.message : e);
  }

  // Upstream subject tags (#473). Each `minerva:upstreamTag "..."`
  // literal becomes a real `minerva:hasTag` edge to the
  // corresponding tag URI, mirroring the body-tag pipeline so a
  // CrossRef-imported tag and a hand-authored body tag look the
  // same in the tag panel.
  for (const st of store.statementsMatching(subject, MINERVA('upstreamTag'), undefined, graph)) {
    const name = st.object.value;
    if (!name) continue;
    const tagNode = tagUri(state, name);
    ensureTag(state, tagNode, name);
    store.add(subject, MINERVA('hasTag'), tagNode, graph);
  }

  // User-added tags (#766). Each `minerva:tag "..."` literal becomes a
  // hasTag edge too, so a tag added via the source's add/remove affordance
  // looks identical to an upstream or body tag in the tag panel + smart
  // collections. Distinct predicate from upstreamTag so "Strip upstream
  // tags" leaves the user's own tags alone.
  for (const st of store.statementsMatching(subject, MINERVA('tag'), undefined, graph)) {
    const name = st.object.value;
    if (!name) continue;
    const tagNode = tagUri(state, name);
    ensureTag(state, tagNode, name);
    store.add(subject, MINERVA('hasTag'), tagNode, graph);
  }

  if (bodyMd) indexSourceBody(state, sourceId, bodyMd, subject, graph);
}

/** Parse body.md for a source — tags and wiki-links attach to the source URI. */
function indexSourceBody(
  state: GraphState,
  _sourceId: string,
  bodyMd: string,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  const { store } = state;
  const parsed = parseMarkdown(bodyMd);

  // Body tags → hasTag edges on the source.
  const tags = new Set(parsed.tags);
  const fmTags = parsed.frontmatter.tags;
  if (fmTags !== undefined) {
    for (const t of flattenFrontmatterStrings(fmTags)) if (t) tags.add(t);
  }
  for (const tag of tags) {
    const tagNode = tagUri(state, tag);
    ensureTag(state, tagNode, tag);
    store.add(subject, MINERVA('hasTag'), tagNode, graph);
  }

  // Body wiki-links → typed edges on the source (same plumbing as notes).
  for (const link of parsed.links) {
    const linkType = getLinkType(link.type);
    const predicate = linkPredicate(linkType);
    const targetNode = resolveLinkTarget(state, linkType, link.target, link.anchor);
    store.add(subject, predicate, targetNode, graph);
  }
}

export function removeSource(ctx: ProjectContext, sourceId: string): void {
  checkLLMWriteGuard('removeSource');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const subject = sourceUri(state, sourceId);
  state.store.removeMatches(undefined, undefined, undefined, subject);
  state.store.removeMatches(subject, undefined, undefined);
}

/** Parse `<id>` out of `.minerva/sources/<id>/meta.ttl`. Returns null for other paths. */
export function parseSourceIdFromPath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/');
  const prefix = `${uriHelpers.SOURCES_DIR}/`;
  if (!normalized.startsWith(prefix)) return null;
  if (!normalized.endsWith('/meta.ttl')) return null;
  const id = normalized.slice(prefix.length, -'/meta.ttl'.length);
  if (!id || id.includes('/')) return null;
  return id;
}

// ── Excerpt indexing ────────────────────────────────────────────────────────
// An "excerpt" is a verbatim quotation lifted from a Source, stored at
// .minerva/excerpts/<id>.ttl. The excerpt node's URI is `${baseUri}excerpt/<id>`.
// Inside the .ttl file, `this:` resolves to that URI, and `sources:` resolves
// to `${baseUri}source/`, so users can write:
//   this: a thought:Excerpt ;
//       thought:fromSource sources:smith-2023 ;
//       thought:citedText "..." ;
//       thought:page 42 .

export function indexExcerpt(ctx: ProjectContext, excerptId: string, metaTtl: string): void {
  checkLLMWriteGuard('indexExcerpt');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const { store } = state;

  const subject = excerptUri(state, excerptId);
  const graph = subject;
  const relativePath = `${uriHelpers.EXCERPTS_DIR}/${excerptId}.ttl`;

  store.removeMatches(undefined, undefined, undefined, graph);
  store.removeMatches(subject, undefined, undefined);

  store.add(subject, MINERVA('excerptId'), $rdf.lit(excerptId), graph);
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath), graph);
  store.add(subject, DC('modified'), dateLit(fileMtimeIso(state, relativePath)), graph);
  store.add(projectUri(state), MINERVA('containsExcerpt'), subject, graph);

  try {
    const prefixed = injectPrefixes(state, metaTtl, subject.value);
    $rdf.parse(prefixed, store, graph.value, 'text/turtle');
  } catch (e) {
    console.error(`[minerva] Failed to parse excerpt ttl for ${excerptId}:`, e instanceof Error ? e.message : e);
  }
}

export function removeExcerpt(ctx: ProjectContext, excerptId: string): void {
  checkLLMWriteGuard('removeExcerpt');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const { store } = state;
  const subject = excerptUri(state, excerptId);
  store.removeMatches(undefined, undefined, undefined, subject);
  store.removeMatches(subject, undefined, undefined);
}

/**
 * Every excerpt-id with thought:fromSource pointing at the given source.
 * Used by the source-delete path to cascade-remove orphaned excerpts.
 */
export function excerptIdsForSource(ctx: ProjectContext, sourceId: string): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;
  const subject = sourceUri(state, sourceId);
  const stmts = store.statementsMatching(undefined, THOUGHT('fromSource'), subject);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const st of stmts) {
    const idStmts = store.statementsMatching(st.subject, MINERVA('excerptId'), undefined);
    const id = idStmts[0]?.object.value;
    if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids;
}

/** Parse `<id>` out of `.minerva/excerpts/<id>.ttl`. Returns null for other paths. */
export function parseExcerptIdFromPath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/');
  const prefix = `${uriHelpers.EXCERPTS_DIR}/`;
  if (!normalized.startsWith(prefix)) return null;
  if (!normalized.endsWith('.ttl')) return null;
  const id = normalized.slice(prefix.length, -'.ttl'.length);
  if (!id || id.includes('/')) return null;
  return id;
}

function ensureTag(state: GraphState, tagNode: $rdf.NamedNode, tagName: string): void {
  const { store } = state;
  const existing = store.statementsMatching(tagNode, RDF('type'), MINERVA('Tag'));
  if (existing.length === 0) {
    store.add(tagNode, RDF('type'), MINERVA('Tag'));
    store.add(tagNode, MINERVA('tagName'), $rdf.lit(tagName));
  }
}

function ensureFolder(state: GraphState, relativePath: string): void {
  const { store } = state;
  const folder = folderUri(state, relativePath);
  const existing = store.statementsMatching(folder, RDF('type'), MINERVA('Folder'));
  if (existing.length === 0) {
    store.add(folder, RDF('type'), MINERVA('Folder'));
    store.add(folder, MINERVA('relativePath'), $rdf.lit(relativePath));
    store.add(folder, DC('title'), $rdf.lit(path.basename(relativePath)));
    store.add(projectUri(state), MINERVA('containsFolder'), folder);

    // Nest under parent folder if applicable
    const parent = path.dirname(relativePath);
    if (parent && parent !== '.') {
      store.add(folder, MINERVA('inFolder'), folderUri(state, parent));
      ensureFolder(state, parent);
    }
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

export async function indexAllNotes(ctx: ProjectContext): Promise<number> {
  const state = getState(ctx);
  if (!state) return 0;
  const { rootPath } = state;

  // Reset and rebuild from scratch with ontology
  state.store = $rdf.graph();
  invalidate(state);
  addOntologyToStore(state);
  state.aliasesPerNote.clear();
  state.aliasMap.clear();
  state.indexedNotePaths.clear();

  ensureProject(state);

  // Two-pass build (#469): the first walk just reads frontmatter
  // aliases so the alias map is fully populated before any link gets
  // resolved. Otherwise notes indexed early would resolve `[[alias]]`
  // against an empty map and write the wrong target URI.
  await walkAndCollectAliases(rootPath, rootPath);
  rebuildAliasMap(state);

  let count = 0;
  await walkAndIndex(rootPath, rootPath);
  count += await walkAndIndexSources(ctx, rootPath);
  count += await walkAndIndexExcerpts(ctx, rootPath);
  // graph.ttl is a cold snapshot now (#348). The release / quit path
  // writes the snapshot; an in-app rebuild only mutates the live store.

  async function walkAndIndex(dirPath: string, root: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const rel = path.relative(root, fullPath);
        ensureFolder(state!, rel);
        await walkAndIndex(fullPath, root);
      } else if (isIndexable(entry.name)) {
        const relativePath = path.relative(root, fullPath);
        const content = await fs.readFile(fullPath, 'utf-8');
        await indexNote(ctx, relativePath, content);
        count++;
      }
    }
  }

  async function walkAndCollectAliases(dirPath: string, root: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walkAndCollectAliases(fullPath, root);
      } else if (isIndexable(entry.name)) {
        const relativePath = path.relative(root, fullPath);
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

async function walkAndIndexSources(ctx: ProjectContext, rootPath: string): Promise<number> {
  const sourcesRoot = path.join(rootPath, uriHelpers.SOURCES_DIR);
  let count = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(sourcesRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourceId = entry.name;
    const metaPath = path.join(sourcesRoot, sourceId, 'meta.ttl');
    const bodyPath = path.join(sourcesRoot, sourceId, 'body.md');
    try {
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      let bodyContent: string | undefined;
      try { bodyContent = await fs.readFile(bodyPath, 'utf-8'); } catch { /* body optional */ }
      indexSource(ctx, sourceId, metaContent, bodyContent);
      count++;
    } catch {
      // No meta.ttl in this directory — skip
    }
  }
  return count;
}

async function walkAndIndexExcerpts(ctx: ProjectContext, rootPath: string): Promise<number> {
  const excerptsRoot = path.join(rootPath, uriHelpers.EXCERPTS_DIR);
  let count = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(excerptsRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ttl')) continue;
    const excerptId = entry.name.slice(0, -'.ttl'.length);
    const filePath = path.join(excerptsRoot, entry.name);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      indexExcerpt(ctx, excerptId, content);
      count++;
    } catch {
      // Couldn't read — skip
    }
  }
  return count;
}
