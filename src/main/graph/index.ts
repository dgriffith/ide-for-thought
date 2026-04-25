import * as $rdf from 'rdflib';
import { QueryEngine } from '@comunica/query-sparql-rdfjs';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseMarkdown, type ParsedTable, type FrontmatterValue } from './parser';
import { getLinkType, type LinkType } from '../../shared/link-types';
import { mapFrontmatterKey, type FrontmatterPredicate } from './frontmatter-predicates';
import { slugify } from '../../shared/slug';
import { parseCsv } from '../../shared/csv-parse';
import { isIndexable } from '../notebase/indexable-files';
import * as uriHelpers from './uri-helpers';

import * as N3 from 'n3';

let engine: QueryEngine | null = null;

// N3 cache + invalidation now live on GraphState (per-project) — see
// `state.n3Cache` and the `invalidate(state)` helper above.

/** Build an N3.Store from rdflib's IndexedFormula for Comunica to query */
function buildN3Store(s: $rdf.IndexedFormula): N3.Store {
  const n3Store = new N3.Store();
  const df = N3.DataFactory;

  for (const st of s.statements) {
    try {
      const subject = convertTerm(st.subject, df);
      const predicate = convertTerm(st.predicate, df) as N3.NamedNode;
      const object = convertTerm(st.object, df);
      if (subject && predicate && object) {
        n3Store.addQuad(subject as any, predicate, object as any, df.defaultGraph());
      }
    } catch { /* skip malformed triples */ }
  }

  return n3Store;
}

function convertTerm(term: any, df: typeof N3.DataFactory): N3.Term | null {
  if (!term || !term.termType) return null;
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

const MINERVA = $rdf.Namespace('https://minerva.dev/ontology#');
const DC      = $rdf.Namespace('http://purl.org/dc/terms/');
const RDF     = $rdf.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const RDFS    = $rdf.Namespace('http://www.w3.org/2000/01/rdf-schema#');
const XSD     = $rdf.Namespace('http://www.w3.org/2001/XMLSchema#');
const CSVW    = $rdf.Namespace('http://www.w3.org/ns/csvw#');
const OWL     = $rdf.Namespace('http://www.w3.org/2002/07/owl#');
const BIBO    = $rdf.Namespace('http://purl.org/ontology/bibo/');
const SCHEMA  = $rdf.Namespace('http://schema.org/');
const PROV    = $rdf.Namespace('http://www.w3.org/ns/prov#');

// ── Per-project state (#333) ────────────────────────────────────────────────
//
// Each open thoughtbase has one GraphState regardless of how many windows
// show it. Lookup is keyed by ctx.rootPath. Internal helpers take a
// `state` parameter where they need any of the project-scoped fields;
// public exports take `ctx: ProjectContext` and resolve state from it.

import type { ProjectContext } from '../project-context-types';

interface HeadingSnapshot {
  slug: string;
  text: string;
  level: number;
}

interface GraphState {
  rootPath: string;
  baseUri: string;
  store: $rdf.IndexedFormula;
  /** N3.Store mirror cached for Comunica; rebuilt on demand by queryGraph. */
  n3Cache: N3.Store | null;
  /** Cached parsed ontology triples; reloaded fresh on init, stripped before persist. */
  ontologyStatements: $rdf.Statement[];
  /** Heading snapshot per note for the rename-detection heuristic. */
  headingsPerNote: Map<string, HeadingSnapshot[]>;
}

const states = new Map<string, GraphState>();

function getState(ctx: ProjectContext): GraphState | null {
  return states.get(ctx.rootPath) ?? null;
}

function requireState(ctx: ProjectContext): GraphState {
  const s = states.get(ctx.rootPath);
  if (!s) throw new Error(`graph: no state for project "${ctx.rootPath}"`);
  return s;
}

function invalidate(state: GraphState): void {
  state.n3Cache = null;
}

/** Tear down a project's graph state. Called by ProjectContext on last release. */
export function disposeProject(ctx: ProjectContext): void {
  states.delete(ctx.rootPath);
}

// ── LLM Write Guard ───────────────────────────────────────────────────────
// Tracks whether the current call path originates from an LLM operation.
// Direct graph writes from LLM context that bypass the approval engine
// are logged as warnings during development. Approval engine wraps its
// own writes in the *trusted* counter so its in-LLM-context writes don't
// trigger the warning.

let llmContextDepth = 0;
let trustedContextDepth = 0;

/** Mark the start of an LLM-originated operation. Nest-safe. */
export function enterLLMContext(): void {
  llmContextDepth++;
}

/** Mark the end of an LLM-originated operation. */
export function exitLLMContext(): void {
  if (llmContextDepth > 0) llmContextDepth--;
}

/** Returns true if currently in an LLM call path. */
export function isInLLMContext(): boolean {
  return llmContextDepth > 0;
}

/**
 * Mark the start of a trusted graph mutation — i.e. one going through the
 * approval engine. Used by approval.ts to wrap its own parseIntoStore /
 * removeMatchingTriples calls so the write guard doesn't flag them.
 */
export function enterTrustedContext(): void {
  trustedContextDepth++;
}

export function exitTrustedContext(): void {
  if (trustedContextDepth > 0) trustedContextDepth--;
}

/** Dev-time guard. Logs once per offending call when an LLM-originated
 *  call path mutates the graph without going through the approval engine.
 *  No-op in trusted context (proposeWrite / approveProposal / approval-only
 *  mutators) and outside LLM context. */
function checkLLMWriteGuard(operation: string): void {
  if (!isInLLMContext()) return;
  if (trustedContextDepth > 0) return;
  console.warn(
    `[trust-guard] ${operation} called from LLM context outside the approval engine. ` +
    `LLM-originated writes must go through proposeWrite()/approveProposal().`,
  );
}

// ── Project config (persisted in .minerva/config.json) ─────────────────────

interface ProjectConfig {
  baseUri: string;
}

function configPath(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'config.json');
}

function readConfig(rootPath: string): ProjectConfig | null {
  try {
    return JSON.parse(fsSync.readFileSync(configPath(rootPath), 'utf-8'));
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

// ── URI helpers (delegate to uri-helpers module) ────────────────────────────

function noteUri(state: GraphState, relativePath: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.noteUri(state.baseUri, relativePath));
}

function tagUri(state: GraphState, tagName: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.tagUri(state.baseUri, tagName));
}

function folderUri(state: GraphState, relativePath: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.folderUri(state.baseUri, relativePath));
}

function sourceUri(state: GraphState, sourceId: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.sourceUri(state.baseUri, sourceId));
}

function excerptUri(state: GraphState, excerptId: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.excerptUri(state.baseUri, excerptId));
}

function tableUri(state: GraphState, tableName: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.tableUri(state.baseUri, tableName));
}

function linkPredicate(lt: LinkType) {
  return lt.predicateNamespace === 'thought' ? THOUGHT(lt.predicate) : MINERVA(lt.predicate);
}

function resolveLinkTarget(state: GraphState, lt: LinkType, target: string, anchor?: string) {
  if (lt.targetKind === 'source') return sourceUri(state, target);
  if (lt.targetKind === 'excerpt') return excerptUri(state, target);
  const base = noteUri(state, target.endsWith('.md') ? target : `${target}.md`);
  // Anchors append as an IRI fragment: headings become `#slug`, block-ids
  // stay as `#^raw-id` (we don't slugify the `^` prefix or its payload so
  // ids survive edits on the referenced block).
  if (!anchor) return base;
  const frag = anchor.startsWith('^') ? anchor : slugify(anchor);
  return $rdf.sym(`${base.value}#${frag}`);
}

/** Strip an IRI fragment (`#…`) if present — use to find the note subject a link points at. */
function stripFragment(uri: string): string {
  const idx = uri.indexOf('#');
  return idx < 0 ? uri : uri.slice(0, idx);
}

function existsPredicateFor(lt: LinkType) {
  if (lt.targetKind === 'source') return MINERVA('sourceId');
  if (lt.targetKind === 'excerpt') return MINERVA('excerptId');
  return MINERVA('relativePath');
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

/** Flatten nested arrays, dropping nulls. Scalars pass through in typed form. */
function flattenFrontmatterScalars(value: FrontmatterValue): FrontmatterScalarNonNull[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flattenFrontmatterScalars);
  return [value];
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
const FRONTMATTER_WIKILINK_RE = /^\[\[([^\[\]\n|]+)(?:\|[^\]]+)?\]\]$/;

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
    const noteRel = target.endsWith('.md') ? target : `${target}.md`;
    return $rdf.sym(uriHelpers.noteUri(projectBaseUri, noteRel));
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

function projectUri(state: GraphState): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.projectUri(state.baseUri));
}

function dateLit(iso: string): $rdf.Literal {
  return $rdf.lit(iso, undefined, XSD('dateTime'));
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

const STANDARD_PREFIXES: [string, string][] = [
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

/** Return headings present in the last indexNote call for `relativePath`, or []. */
export function headingsFor(ctx: ProjectContext, relativePath: string): HeadingSnapshot[] {
  const state = getState(ctx);
  return state?.headingsPerNote.get(relativePath) ?? [];
}

// ── Ontology bootstrap ──────────────────────────────────────────────────────

import ONTOLOGY_TTL from '../../shared/ontology.ttl?raw';
import THOUGHT_ONTOLOGY_TTL from '../../shared/ontology-thought.ttl?raw';

const THOUGHT = $rdf.Namespace('https://minerva.dev/ontology/thought#');

// Ontology triples are loaded fresh on every startup and are not persisted
// to .minerva/graph.ttl. Holding the parsed statements lets us (1) self-heal
// old graph.ttl files that included the ontology by removing any matching
// triples, and (2) strip them before writing on persistGraph().

function addOntologyToStore(state: GraphState): void {
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

// ── Init ────────────────────────────────────────────────────────────────────

export async function initGraph(ctx: ProjectContext): Promise<void> {
  const { rootPath } = ctx;
  const metaDir = path.join(rootPath, '.minerva');
  await fs.mkdir(metaDir, { recursive: true });

  // Initialize Comunica engine (process-wide; stateless across projects)
  if (!engine) engine = new QueryEngine();

  const state: GraphState = {
    rootPath,
    baseUri: resolveBaseUri(rootPath),
    store: $rdf.graph(),
    n3Cache: null,
    ontologyStatements: [],
    headingsPerNote: new Map(),
  };

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

  states.set(rootPath, state);
}

// ── Indexing ────────────────────────────────────────────────────────────────

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
 * Offer a rewrite suggestion only for the unambiguous case where exactly
 * one heading slug disappeared AND exactly one appeared AND there are
 * incoming anchored links to the old slug. Anything else (multiple
 * removals, pure deletion, additions without removals) → no prompt.
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
  if (incoming === 0) return undefined;

  return {
    relativePath,
    oldSlug: old.slug,
    oldText: old.text,
    newSlug: fresh.slug,
    newText: fresh.text,
    incomingLinkCount: incoming,
  };
}

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

function findNotesLinkingToAnchorImpl(
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
 * Index a standalone `.csv` file (#199). Mirrors indexTurtleFile\u2019s
 * note-metadata setup, then parses the file as CSV and emits CSVW
 * triples. The file\u2019s subject IS the Table (`rdf:type csvw:Table`),
 * with `csvw:inFile <relativePath>` for symmetry with the markdown-
 * table indexer\u2019s `csvw:inNote`.
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

  // CSVW: the file IS the Table. One file \u2192 one table.
  store.add(subject, RDF('type'), CSVW('Table'), graph);
  store.add(subject, CSVW('inFile'), $rdf.lit(relativePath), graph);

  const parsed = parseCsv(content);
  if (parsed.headers.length === 0) return;

  // Columns
  const colNodes: $rdf.NamedNode[] = [];
  for (let ci = 0; ci < parsed.headers.length; ci++) {
    const colName = parsed.headers[ci];
    const colUri = $rdf.sym(`${subject.value}/column/${encodeURIComponent(colName)}`);
    colNodes.push(colUri);
    store.add(colUri, RDF('type'), CSVW('Column'), graph);
    store.add(colUri, CSVW('name'), $rdf.lit(colName), graph);
    store.add(colUri, CSVW('columnIndex'), $rdf.lit(String(ci), undefined, XSD('integer')), graph);
    store.add(subject, CSVW('column'), colUri, graph);
  }

  // Rows + cells
  for (let ri = 0; ri < parsed.rows.length; ri++) {
    const rowUri = $rdf.sym(`${subject.value}/row/${ri}`);
    store.add(rowUri, RDF('type'), CSVW('Row'), graph);
    store.add(rowUri, CSVW('rowIndex'), $rdf.lit(String(ri), undefined, XSD('integer')), graph);
    store.add(subject, CSVW('row'), rowUri, graph);

    for (let ci = 0; ci < parsed.headers.length; ci++) {
      const value = parsed.rows[ri][ci] ?? '';
      const cellUri = $rdf.sym(`${rowUri.value}/cell/${encodeURIComponent(parsed.headers[ci])}`);
      store.add(cellUri, RDF('type'), CSVW('Cell'), graph);
      store.add(cellUri, CSVW('column'), colNodes[ci], graph);
      store.add(cellUri, RDF('value'), $rdf.lit(value), graph);
      store.add(rowUri, CSVW('cell'), cellUri, graph);
    }
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

  ensureProject(state);

  let count = 0;
  await walkAndIndex(rootPath, rootPath);
  count += await walkAndIndexSources(ctx, rootPath);
  count += await walkAndIndexExcerpts(ctx, rootPath);
  await persistGraph(ctx);

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

// ── Query ───────────────────────────────────────────────────────────────────

const SPARQL_PREFIXES = STANDARD_PREFIXES
  .map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>`)
  .join('\n') + '\n';

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
 * Snapshot of the live graph\u2019s predicates + classes for autocomplete (#198).
 * Sorted alphabetically by prefixed form when available, otherwise by full
 * IRI. Safe to call often \u2014 cheap walk over the store.
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

export async function queryGraph(ctx: ProjectContext, sparql: string): Promise<{ results: unknown[] }> {
  const state = getState(ctx);
  if (!state || !engine) return { results: [] };
  const { store } = state;

  try {
    if (!state.n3Cache) state.n3Cache = buildN3Store(store);
    const n3Store = state.n3Cache;
    const prefixed = injectSparqlPrefixes(sparql);
    const bindingsStream = await engine.queryBindings(prefixed, {
      sources: [n3Store],
    });
    const bindings = await bindingsStream.toArray();

    const results = bindings.map((binding) => {
      const obj: Record<string, string> = {};
      for (const [variable, term] of binding) {
        obj[variable.value] = term.value;
      }
      return obj;
    });

    return { results };
  } catch (e) {
    return { results: [], error: String(e) } as any;
  }
}

// ── Tag queries ─────────────────────────────────────────────────────────────

import type { TagInfo, TaggedNote, TaggedSource } from '../../shared/types';

export function listTags(ctx: ProjectContext): TagInfo[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const tagCounts = new Map<string, number>();
  const stmts = store.statementsMatching(undefined, MINERVA('hasTag'), undefined);
  for (const st of stmts) {
    const tagNode = st.object;
    const nameStmts = store.statementsMatching(tagNode as $rdf.NamedNode, MINERVA('tagName'), undefined);
    const name = nameStmts[0]?.object.value ?? tagNode.value;
    tagCounts.set(name, (tagCounts.get(name) ?? 0) + 1);
  }

  return [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
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
    const isNote = store!.statementsMatching(subject, RDF('type'), MINERVA('Note')).length > 0;
    if (!isNote) return [];
    const titleStmts = store!.statementsMatching(subject, DC('title'), undefined);
    const pathStmts = store!.statementsMatching(subject, MINERVA('relativePath'), undefined);
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
    const idStmts = store!.statementsMatching(subject, MINERVA('sourceId'), undefined);
    const sourceId = idStmts[0]?.object.value;
    if (!sourceId) return [];
    const titleStmts = store!.statementsMatching(subject, DC('title'), undefined);
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

import type { OutgoingLink, Backlink } from '../../shared/types';
import { LINK_TYPES } from '../../shared/link-types';

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
export function findNotesLinkingTo(ctx: ProjectContext, targetRelativePath: string): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;
  const targetBase = noteUri(state, targetRelativePath).value;
  const seen = new Set<string>();
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    // Match both `<noteUri>` and `<noteUri>#<anchor>` targets.
    const stmts = store.statementsMatching(undefined, linkPredicate(lt), undefined);
    for (const st of stmts) {
      const objValue = st.object.value;
      if (objValue !== targetBase && !objValue.startsWith(`${targetBase}#`)) continue;
      const sourceNode = st.subject;
      const pathStmts = store.statementsMatching(sourceNode, MINERVA('relativePath'), undefined);
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

// ── Source detail queries ───────────────────────────────────────────────────

import type { SourceDetail, SourceMetadata, SourceExcerpt, SourceBacklink } from '../../shared/types';

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

  return { metadata, excerpts, backlinks };
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
    const stmts = store!.statementsMatching(subject, pred, undefined);
    return stmts[0]?.object.value ?? null;
  };

  const issued = first(DC('issued'));
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
  };
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
      const s = store!.statementsMatching(ex, pred, undefined);
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
    const pathStmts = store!.statementsMatching(noteSubject, MINERVA('relativePath'), undefined);
    const relativePath = pathStmts[0]?.object.value;
    if (!relativePath) return;
    const key = `${kind}::${relativePath}::${viaExcerptId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const titleStmts = store!.statementsMatching(noteSubject, DC('title'), undefined);
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
