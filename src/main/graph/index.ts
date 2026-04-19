import * as $rdf from 'rdflib';
import { QueryEngine } from '@comunica/query-sparql-rdfjs';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseMarkdown, type ParsedTable, type FrontmatterValue } from './parser';
import { getLinkType, type LinkType } from '../../shared/link-types';
import { mapFrontmatterKey, type FrontmatterPredicate } from './frontmatter-predicates';
import * as uriHelpers from './uri-helpers';

import * as N3 from 'n3';

let engine: QueryEngine | null = null;

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
const XSD     = $rdf.Namespace('http://www.w3.org/2001/XMLSchema#');
const CSVW    = $rdf.Namespace('http://www.w3.org/ns/csvw#');
const BIBO    = $rdf.Namespace('http://purl.org/ontology/bibo/');
const SCHEMA  = $rdf.Namespace('http://schema.org/');

let baseUri = '';      // e.g. https://project.minerva.dev/dave/my-notes/
let store: $rdf.IndexedFormula | null = null;
let currentRootPath: string | null = null;

// ── LLM Write Guard ───────────────────────────────────────────────────────
// Tracks whether the current call path originates from an LLM operation.
// Direct graph writes from LLM context that bypass the approval engine
// are logged as warnings during development.

let llmContextDepth = 0;

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
 * Add a triple to the store with write-guard checking.
 * In LLM context, logs a warning unless the write is to a Proposal node.
 */
function guardedAdd(
  s: $rdf.NamedNode,
  p: $rdf.NamedNode,
  o: $rdf.Node,
  graph?: $rdf.NamedNode,
): void {
  if (!store) return;
  if (llmContextDepth > 0) {
    const isProposal = s.value.includes('/proposal/') || o.value?.includes?.('Proposal');
    if (!isProposal) {
      console.warn(`[minerva:trust] Direct graph write from LLM context: ${s.value} ${p.value} — should go through approval engine`);
    }
  }
  store.add(s, p, o, graph);
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

function noteUri(relativePath: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.noteUri(baseUri, relativePath));
}

function tagUri(tagName: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.tagUri(baseUri, tagName));
}

function folderUri(relativePath: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.folderUri(baseUri, relativePath));
}

function sourceUri(sourceId: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.sourceUri(baseUri, sourceId));
}

function excerptUri(excerptId: string): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.excerptUri(baseUri, excerptId));
}

function linkPredicate(lt: LinkType) {
  return lt.predicateNamespace === 'thought' ? THOUGHT(lt.predicate) : MINERVA(lt.predicate);
}

function resolveLinkTarget(lt: LinkType, target: string) {
  if (lt.targetKind === 'source') return sourceUri(target);
  if (lt.targetKind === 'excerpt') return excerptUri(target);
  return noteUri(target.endsWith('.md') ? target : `${target}.md`);
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

function projectUri(): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.projectUri(baseUri));
}

function dateLit(iso: string): $rdf.Literal {
  return $rdf.lit(iso, undefined, XSD('dateTime'));
}

const STANDARD_PREFIXES: [string, string][] = [
  ['minerva', 'https://minerva.dev/ontology#'],
  ['thought', 'https://minerva.dev/ontology/thought#'],
  ['dc', 'http://purl.org/dc/terms/'],
  ['rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
  ['rdfs', 'http://www.w3.org/2000/01/rdf-schema#'],
  ['xsd', 'http://www.w3.org/2001/XMLSchema#'],
  ['csvw', 'http://www.w3.org/ns/csvw#'],
  ['prov', 'http://www.w3.org/ns/prov#'],
  ['bibo', 'http://purl.org/ontology/bibo/'],
  ['schema', 'http://schema.org/'],
];

function injectPrefixes(turtle: string, noteIri: string): string {
  const lines: string[] = [];
  for (const [prefix, iri] of STANDARD_PREFIXES) {
    if (!turtle.includes(`@prefix ${prefix}:`)) {
      lines.push(`@prefix ${prefix}: <${iri}> .`);
    }
  }
  // Project-scoped shortcuts for referring to other sources/excerpts in
  // this thoughtbase by bare id: `sources:smith-2023`, `excerpts:p42`.
  if (baseUri) {
    if (!turtle.includes('@prefix sources:')) {
      lines.push(`@prefix sources: <${baseUri}source/> .`);
    }
    if (!turtle.includes('@prefix excerpts:')) {
      lines.push(`@prefix excerpts: <${baseUri}excerpt/> .`);
    }
  }
  if (!turtle.includes('@prefix this:')) {
    lines.push(`@prefix this: <${noteIri}> .`);
  }
  lines.push('');
  return lines.join('\n') + turtle;
}

// ── Ontology bootstrap ──────────────────────────────────────────────────────

import ONTOLOGY_TTL from '../../shared/ontology.ttl?raw';
import THOUGHT_ONTOLOGY_TTL from '../../shared/ontology-thought.ttl?raw';

const THOUGHT = $rdf.Namespace('https://minerva.dev/ontology/thought#');

// Ontology triples are loaded fresh on every startup and are not persisted
// to .minerva/graph.ttl. Holding the parsed statements lets us (1) self-heal
// old graph.ttl files that included the ontology by removing any matching
// triples, and (2) strip them before writing on persistGraph().
let ontologyStatements: $rdf.Statement[] = [];

function addOntologyToStore(): void {
  if (!store) return;
  const tempStore = $rdf.graph();
  try {
    $rdf.parse(ONTOLOGY_TTL, tempStore, MINERVA('').value, 'text/turtle');
  } catch { /* ontology parse failure is non-fatal */ }
  try {
    $rdf.parse(THOUGHT_ONTOLOGY_TTL, tempStore, THOUGHT('').value, 'text/turtle');
  } catch { /* thought ontology parse failure is non-fatal */ }
  ontologyStatements = tempStore.statements.slice();
  for (const st of ontologyStatements) {
    store.removeMatches(st.subject, st.predicate, st.object);
  }
  for (const st of ontologyStatements) {
    store.add(st.subject, st.predicate, st.object, st.graph);
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

export async function initGraph(rootPath: string): Promise<void> {
  store = $rdf.graph();
  currentRootPath = rootPath;

  const metaDir = path.join(rootPath, '.minerva');
  await fs.mkdir(metaDir, { recursive: true });

  // Resolve (or coin) the stable base URI for this project
  baseUri = resolveBaseUri(rootPath);

  // Initialize Comunica engine
  if (!engine) engine = new QueryEngine();

  // Load persisted graph if it exists
  const graphPath = path.join(metaDir, 'graph.ttl');
  try {
    const turtle = await fs.readFile(graphPath, 'utf-8');
    $rdf.parse(turtle, store, 'urn:x-minerva:void', 'text/turtle');
  } catch {
    // No persisted graph yet, start fresh
  }

  // Load ontology last: addOntologyToStore() strips any matching triples
  // before re-adding, which self-heals graph.ttl files written by older
  // versions that persisted the ontology alongside the user's data.
  addOntologyToStore();
}

// ── Indexing ────────────────────────────────────────────────────────────────

export async function indexNote(relativePath: string, content: string): Promise<void> {
  if (!store) return;

  const subject = noteUri(relativePath);
  const graph = subject; // named graph = note URI, for clean removal on re-index

  // Remove ALL triples from this note's graph (handles arbitrary turtle subjects)
  store.removeMatches(undefined, undefined, undefined, graph);
  // Also remove any legacy triples with no graph (from before named-graph tracking)
  store.removeMatches(subject, undefined, undefined);

  if (relativePath.endsWith('.ttl')) {
    indexTurtleFile(relativePath, content, subject, graph);
    return;
  }

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

  // Timestamps
  store.add(subject, DC('modified'), dateLit(new Date().toISOString()), graph);

  // Folder membership
  const dir = path.dirname(relativePath);
  if (dir && dir !== '.') {
    store.add(subject, MINERVA('inFolder'), folderUri(dir), graph);
    ensureFolder(dir);
  }

  // Project membership
  store.add(projectUri(), MINERVA('containsNote'), subject, graph);

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
    const tagNode = tagUri(tag);
    ensureTag(tagNode, tag);
    store.add(subject, MINERVA('hasTag'), tagNode, graph);
  }

  // Wiki-links — typed predicates
  for (const link of parsed.links) {
    const linkType = getLinkType(link.type);
    const predicate = linkPredicate(linkType);
    const targetNode = resolveLinkTarget(linkType, link.target);
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
      const prefixed = injectPrefixes(block, subject.value);
      $rdf.parse(prefixed, store, graph.value, 'text/turtle');
    } catch (e) {
      console.error(`[minerva] Failed to parse turtle block in ${relativePath}:`, e instanceof Error ? e.message : e);
    }
  }

  // Markdown tables — CSVW triples
  for (let ti = 0; ti < parsed.tables.length; ti++) {
    indexTable(parsed.tables[ti], ti, subject, graph);
  }
}

function indexTable(
  table: ParsedTable,
  tableIndex: number,
  noteNode: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  if (!store) return;

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

function indexTurtleFile(
  relativePath: string,
  content: string,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  if (!store) return;

  // Basic file metadata
  store.add(subject, RDF('type'), MINERVA('Note'), graph);
  const title = path.basename(relativePath, '.ttl');
  store.add(subject, DC('title'), $rdf.lit(title), graph);
  store.add(subject, MINERVA('filename'), $rdf.lit(path.basename(relativePath)), graph);
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath), graph);
  store.add(subject, DC('modified'), dateLit(new Date().toISOString()), graph);

  // Folder membership
  const dir = path.dirname(relativePath);
  if (dir && dir !== '.') {
    store.add(subject, MINERVA('inFolder'), folderUri(dir), graph);
    ensureFolder(dir);
  }

  // Project membership
  store.add(projectUri(), MINERVA('containsNote'), subject, graph);

  // Parse the entire file as Turtle into the note's named graph
  try {
    const prefixed = injectPrefixes(content, subject.value);
    $rdf.parse(prefixed, store, graph.value, 'text/turtle');
  } catch (e) {
    console.error(`[minerva] Failed to parse turtle file ${relativePath}:`, e instanceof Error ? e.message : e);
  }
}

export function removeNote(relativePath: string): void {
  if (!store) return;
  const subject = noteUri(relativePath);
  // Remove all triples in this note's named graph
  store.removeMatches(undefined, undefined, undefined, subject);
  // Also remove any legacy triples with no graph
  store.removeMatches(subject, undefined, undefined);
}

// ── Source indexing ─────────────────────────────────────────────────────────
// A "source" is a citable external work (Article, Book, WebPage, …) whose
// canonical metadata lives at .minerva/sources/<id>/meta.ttl. The source
// node's URI is `${baseUri}source/<id>`; inside meta.ttl, `this:` resolves
// to that URI so users can write `this: a thought:Article ; dc:title ...`.

export function indexSource(sourceId: string, metaTtl: string, bodyMd?: string): void {
  if (!store) return;

  const subject = sourceUri(sourceId);
  const graph = subject;
  const relativePath = `${uriHelpers.SOURCES_DIR}/${sourceId}/meta.ttl`;

  store.removeMatches(undefined, undefined, undefined, graph);
  store.removeMatches(subject, undefined, undefined);

  store.add(subject, MINERVA('sourceId'), $rdf.lit(sourceId), graph);
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath), graph);
  store.add(subject, DC('modified'), dateLit(new Date().toISOString()), graph);
  store.add(projectUri(), MINERVA('containsSource'), subject, graph);

  try {
    const prefixed = injectPrefixes(metaTtl, subject.value);
    $rdf.parse(prefixed, store, graph.value, 'text/turtle');
  } catch (e) {
    console.error(`[minerva] Failed to parse source meta.ttl for ${sourceId}:`, e instanceof Error ? e.message : e);
  }

  if (bodyMd) indexSourceBody(sourceId, bodyMd, subject, graph);
}

/** Parse body.md for a source — tags and wiki-links attach to the source URI. */
function indexSourceBody(
  _sourceId: string,
  bodyMd: string,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  if (!store) return;
  const parsed = parseMarkdown(bodyMd);

  // Body tags → hasTag edges on the source.
  const tags = new Set(parsed.tags);
  const fmTags = parsed.frontmatter.tags;
  if (fmTags !== undefined) {
    for (const t of flattenFrontmatterStrings(fmTags)) if (t) tags.add(t);
  }
  for (const tag of tags) {
    const tagNode = tagUri(tag);
    ensureTag(tagNode, tag);
    store.add(subject, MINERVA('hasTag'), tagNode, graph);
  }

  // Body wiki-links → typed edges on the source (same plumbing as notes).
  for (const link of parsed.links) {
    const linkType = getLinkType(link.type);
    const predicate = linkPredicate(linkType);
    const targetNode = resolveLinkTarget(linkType, link.target);
    store.add(subject, predicate, targetNode, graph);
  }
}

export function removeSource(sourceId: string): void {
  if (!store) return;
  const subject = sourceUri(sourceId);
  store.removeMatches(undefined, undefined, undefined, subject);
  store.removeMatches(subject, undefined, undefined);
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

export function indexExcerpt(excerptId: string, metaTtl: string): void {
  if (!store) return;

  const subject = excerptUri(excerptId);
  const graph = subject;
  const relativePath = `${uriHelpers.EXCERPTS_DIR}/${excerptId}.ttl`;

  store.removeMatches(undefined, undefined, undefined, graph);
  store.removeMatches(subject, undefined, undefined);

  store.add(subject, MINERVA('excerptId'), $rdf.lit(excerptId), graph);
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath), graph);
  store.add(subject, DC('modified'), dateLit(new Date().toISOString()), graph);
  store.add(projectUri(), MINERVA('containsExcerpt'), subject, graph);

  try {
    const prefixed = injectPrefixes(metaTtl, subject.value);
    $rdf.parse(prefixed, store, graph.value, 'text/turtle');
  } catch (e) {
    console.error(`[minerva] Failed to parse excerpt ttl for ${excerptId}:`, e instanceof Error ? e.message : e);
  }
}

export function removeExcerpt(excerptId: string): void {
  if (!store) return;
  const subject = excerptUri(excerptId);
  store.removeMatches(undefined, undefined, undefined, subject);
  store.removeMatches(subject, undefined, undefined);
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

function ensureTag(tagNode: $rdf.NamedNode, tagName: string): void {
  if (!store) return;
  const existing = store.statementsMatching(tagNode, RDF('type'), MINERVA('Tag'));
  if (existing.length === 0) {
    store.add(tagNode, RDF('type'), MINERVA('Tag'));
    store.add(tagNode, MINERVA('tagName'), $rdf.lit(tagName));
  }
}

function ensureFolder(relativePath: string): void {
  if (!store) return;
  const folder = folderUri(relativePath);
  const existing = store.statementsMatching(folder, RDF('type'), MINERVA('Folder'));
  if (existing.length === 0) {
    store.add(folder, RDF('type'), MINERVA('Folder'));
    store.add(folder, MINERVA('relativePath'), $rdf.lit(relativePath));
    store.add(folder, DC('title'), $rdf.lit(path.basename(relativePath)));
    store.add(projectUri(), MINERVA('containsFolder'), folder);

    // Nest under parent folder if applicable
    const parent = path.dirname(relativePath);
    if (parent && parent !== '.') {
      store.add(folder, MINERVA('inFolder'), folderUri(parent));
      ensureFolder(parent);
    }
  }
}

function ensureProject(): void {
  if (!store) return;
  const proj = projectUri();
  const existing = store.statementsMatching(proj, RDF('type'), MINERVA('Project'));
  if (existing.length === 0) {
    store.add(proj, RDF('type'), MINERVA('Project'));
    if (currentRootPath) {
      store.add(proj, DC('title'), $rdf.lit(path.basename(currentRootPath)));
    }
  }
}

export async function indexAllNotes(rootPath: string): Promise<number> {
  if (!store) return 0;

  // Reset and rebuild from scratch with ontology
  store = $rdf.graph();
  addOntologyToStore();

  ensureProject();

  let count = 0;
  await walkAndIndex(rootPath, rootPath);
  count += await walkAndIndexSources(rootPath);
  count += await walkAndIndexExcerpts(rootPath);
  await persistGraph();

  async function walkAndIndex(dirPath: string, root: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const rel = path.relative(root, fullPath);
        ensureFolder(rel);
        await walkAndIndex(fullPath, root);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.ttl')) {
        const relativePath = path.relative(root, fullPath);
        const content = await fs.readFile(fullPath, 'utf-8');
        await indexNote(relativePath, content);
        count++;
      }
    }
  }

  return count;
}

async function walkAndIndexSources(rootPath: string): Promise<number> {
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
      indexSource(sourceId, metaContent, bodyContent);
      count++;
    } catch {
      // No meta.ttl in this directory — skip
    }
  }
  return count;
}

async function walkAndIndexExcerpts(rootPath: string): Promise<number> {
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
      indexExcerpt(excerptId, content);
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

function injectSparqlPrefixes(sparql: string): string {
  // Only inject prefixes that aren't already declared in the query
  const lines: string[] = [];
  for (const [prefix, iri] of STANDARD_PREFIXES) {
    if (!sparql.includes(`PREFIX ${prefix}:`) && !sparql.includes(`prefix ${prefix}:`)) {
      lines.push(`PREFIX ${prefix}: <${iri}>`);
    }
  }
  return lines.length > 0 ? lines.join('\n') + '\n' + sparql : sparql;
}

export async function queryGraph(sparql: string): Promise<{ results: unknown[] }> {
  if (!store || !engine) return { results: [] };

  try {
    const n3Store = buildN3Store(store);
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

export function listTags(): TagInfo[] {
  if (!store) return [];

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

export function notesByTag(tag: string): TaggedNote[] {
  if (!store) return [];

  const tagNode = tagUri(tag);
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

export function sourcesByTag(tag: string): TaggedSource[] {
  if (!store) return [];

  const tagNode = tagUri(tag);
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

export function allTags(): string[] {
  if (!store) return [];
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

export function outgoingLinks(relativePath: string): OutgoingLink[] {
  if (!store) return [];

  const subject = noteUri(relativePath);
  const results: OutgoingLink[] = [];

  for (const lt of LINK_TYPES) {
    const stmts = store.statementsMatching(subject, linkPredicate(lt), undefined);
    for (const st of stmts) {
      const targetNode = st.object as $rdf.NamedNode;
      const pathStmts = store.statementsMatching(targetNode, MINERVA('relativePath'), undefined);
      const titleStmts = store.statementsMatching(targetNode, DC('title'), undefined);
      const existsPredicate = existsPredicateFor(lt);
      const typeStmts = store.statementsMatching(targetNode, existsPredicate, undefined);
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
export function findNotesLinkingTo(targetRelativePath: string): string[] {
  if (!store) return [];
  const target = noteUri(targetRelativePath);
  const seen = new Set<string>();
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    const stmts = store.statementsMatching(undefined, linkPredicate(lt), target);
    for (const st of stmts) {
      const sourceNode = st.subject;
      const pathStmts = store.statementsMatching(sourceNode, MINERVA('relativePath'), undefined);
      const sourcePath = pathStmts[0]?.object.value;
      if (sourcePath && sourcePath.endsWith('.md')) seen.add(sourcePath);
    }
  }
  return [...seen];
}

export function backlinks(relativePath: string): Backlink[] {
  if (!store) return [];

  const target = noteUri(relativePath);
  const results: Backlink[] = [];

  for (const lt of LINK_TYPES) {
    const stmts = store.statementsMatching(undefined, linkPredicate(lt), target);
    for (const st of stmts) {
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

export function getSourceDetail(sourceId: string): SourceDetail | null {
  if (!store) return null;

  const subject = sourceUri(sourceId);
  // Probe for existence via sourceId triple (which indexSource always writes).
  const exists = store.statementsMatching(subject, MINERVA('sourceId'), undefined).length > 0;
  if (!exists) return null;

  const metadata = collectSourceMetadata(sourceId, subject);
  const excerpts = collectExcerptsForSource(subject);
  const backlinks = collectSourceBacklinks(subject, excerpts);

  return { metadata, excerpts, backlinks };
}

function collectSourceMetadata(sourceId: string, subject: $rdf.NamedNode): SourceMetadata {
  if (!store) {
    return {
      sourceId, subtype: null, title: null, creators: [], year: null,
      publisher: null, doi: null, uri: null, abstract: null,
    };
  }

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

function collectExcerptsForSource(sourceSubject: $rdf.NamedNode): SourceExcerpt[] {
  if (!store) return [];

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
  sourceSubject: $rdf.NamedNode,
  excerpts: SourceExcerpt[],
): SourceBacklink[] {
  if (!store) return [];

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
    const exNode = excerptUri(ex.excerptId);
    for (const st of store.statementsMatching(undefined, THOUGHT('quotes'), exNode)) {
      pushBacklink(st.subject as $rdf.NamedNode, 'quote', ex.excerptId);
    }
  }

  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

/** Resolve an excerpt-id to the sourceId of its fromSource, or null if not found. */
export function getExcerptSource(excerptId: string): { sourceId: string } | null {
  if (!store) return null;
  const ex = excerptUri(excerptId);
  const stmts = store.statementsMatching(ex, THOUGHT('fromSource'), undefined);
  const sourceNode = stmts[0]?.object as $rdf.NamedNode | undefined;
  if (!sourceNode) return null;
  const idStmts = store.statementsMatching(sourceNode, MINERVA('sourceId'), undefined);
  const id = idStmts[0]?.object.value;
  return id ? { sourceId: id } : null;
}

// ── Persistence & Export ────────────────────────────────────────────────────

export async function persistGraph(): Promise<void> {
  if (!store || !currentRootPath) return;

  const graphPath = path.join(currentRootPath, '.minerva', 'graph.ttl');
  // Strip ontology triples before serializing — they're re-loaded fresh
  // from the embedded resource on startup, so persisting them would
  // cause duplication on the next load.
  for (const st of ontologyStatements) {
    store.removeMatches(st.subject, st.predicate, st.object);
  }
  const turtle = serializeGraph();
  for (const st of ontologyStatements) {
    store.add(st.subject, st.predicate, st.object, st.graph);
  }
  await fs.writeFile(graphPath, turtle, 'utf-8');
}

/** Parse a Turtle string and add its triples to the store. Used by the approval engine. */
export function parseIntoStore(turtle: string): void {
  if (!store) return;
  try {
    $rdf.parse(turtle, store, 'urn:x-minerva:void', 'text/turtle');
  } catch (e) {
    console.error('[minerva] Failed to parse turtle into store:', e instanceof Error ? e.message : e);
  }
}

export function serializeGraph(): string {
  if (!store) return '';
  // Pass a dummy base that doesn't match any of our URIs,
  // forcing the serializer to emit all IRIs as absolute.
  return $rdf.serialize(null, store, 'urn:x-minerva:void', 'text/turtle') ?? '';
}

export async function exportGraph(destPath: string): Promise<void> {
  if (!store) return;
  await persistGraph();
  const turtle = serializeGraph();
  await fs.writeFile(destPath, turtle, 'utf-8');
}
