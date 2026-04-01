import * as $rdf from 'rdflib';
import { QueryEngine } from '@comunica/query-sparql-rdfjs';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseMarkdown } from './parser';
import { getLinkType } from '../../shared/link-types';
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

let baseUri = '';      // e.g. https://project.minerva.dev/dave/my-notes/
let store: $rdf.IndexedFormula | null = null;
let currentRootPath: string | null = null;

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

function projectUri(): $rdf.NamedNode {
  return $rdf.sym(uriHelpers.projectUri(baseUri));
}

function dateLit(iso: string): $rdf.Literal {
  return $rdf.lit(iso, undefined, XSD('dateTime'));
}

// ── Ontology bootstrap ──────────────────────────────────────────────────────

import ONTOLOGY_TTL from '../../shared/ontology.ttl?raw';

function addOntologyToStore(): void {
  if (!store) return;
  try {
    $rdf.parse(ONTOLOGY_TTL, store, MINERVA('').value, 'text/turtle');
  } catch { /* ontology parse failure is non-fatal */ }
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

  // Load the ontology definitions into the store
  addOntologyToStore();

  // Load persisted graph if it exists
  const graphPath = path.join(metaDir, 'graph.ttl');
  try {
    const turtle = await fs.readFile(graphPath, 'utf-8');
    $rdf.parse(turtle, store, 'urn:x-minerva:void', 'text/turtle');
  } catch {
    // No persisted graph yet, start fresh
  }
}

// ── Indexing ────────────────────────────────────────────────────────────────

export async function indexNote(relativePath: string, content: string): Promise<void> {
  if (!store) return;

  const subject = noteUri(relativePath);

  // Remove existing triples for this note
  store.removeMatches(subject, undefined, undefined);

  // Type
  store.add(subject, RDF('type'), MINERVA('Note'));

  // Parse markdown
  const parsed = parseMarkdown(content);

  // Title
  const title = parsed.title ?? path.basename(relativePath, '.md');
  store.add(subject, DC('title'), $rdf.lit(title));

  // File info
  store.add(subject, MINERVA('filename'), $rdf.lit(path.basename(relativePath)));
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath));

  // Timestamps
  store.add(subject, DC('modified'), dateLit(new Date().toISOString()));

  // Folder membership
  const dir = path.dirname(relativePath);
  if (dir && dir !== '.') {
    const folder = folderUri(dir);
    store.add(subject, MINERVA('inFolder'), folder);
    ensureFolder(dir);
  }

  // Project membership
  store.add(projectUri(), MINERVA('containsNote'), subject);

  // Tags — modeled as resources
  for (const tag of parsed.tags) {
    const tagNode = tagUri(tag);
    ensureTag(tagNode, tag);
    store.add(subject, MINERVA('hasTag'), tagNode);
  }

  // Wiki-links — typed predicates
  for (const link of parsed.links) {
    const target = link.target.endsWith('.md') ? link.target : `${link.target}.md`;
    const linkType = getLinkType(link.type);
    store.add(subject, MINERVA(linkType.predicate), noteUri(target));
  }

  // Frontmatter as dc: or minerva: properties
  for (const [key, value] of Object.entries(parsed.frontmatter)) {
    if (key === 'title') continue;
    if (key === 'description') {
      store.add(subject, DC('description'), $rdf.lit(value));
    } else if (key === 'created') {
      store.add(subject, DC('created'), dateLit(value));
    } else {
      store.add(subject, MINERVA(`meta-${key}`), $rdf.lit(value));
    }
  }
}

export function removeNote(relativePath: string): void {
  if (!store) return;
  const subject = noteUri(relativePath);
  store.removeMatches(subject, undefined, undefined);
  const proj = projectUri();
  const containsStmt = store.statementsMatching(proj, MINERVA('containsNote'), subject);
  for (const st of containsStmt) {
    store.remove(st);
  }
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
      } else if (entry.name.endsWith('.md')) {
        const relativePath = path.relative(root, fullPath);
        const content = await fs.readFile(fullPath, 'utf-8');
        await indexNote(relativePath, content);
        count++;
      }
    }
  }

  return count;
}

// ── Query ───────────────────────────────────────────────────────────────────

export async function queryGraph(sparql: string): Promise<{ results: unknown[] }> {
  if (!store || !engine) return { results: [] };

  try {
    const n3Store = buildN3Store(store);
    const bindingsStream = await engine.queryBindings(sparql, {
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

import type { TagInfo, TaggedNote } from '../../shared/types';

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
  return stmts.map((st) => {
    const subject = st.subject;
    const titleStmts = store!.statementsMatching(subject, DC('title'), undefined);
    const pathStmts = store!.statementsMatching(subject, MINERVA('relativePath'), undefined);
    return {
      title: titleStmts[0]?.object.value ?? subject.value,
      relativePath: pathStmts[0]?.object.value ?? '',
    };
  }).filter((n) => n.relativePath);
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
    const stmts = store.statementsMatching(subject, MINERVA(lt.predicate), undefined);
    for (const st of stmts) {
      const targetNode = st.object as $rdf.NamedNode;
      const pathStmts = store.statementsMatching(targetNode, MINERVA('relativePath'), undefined);
      const titleStmts = store.statementsMatching(targetNode, DC('title'), undefined);
      const typeStmts = store.statementsMatching(targetNode, RDF('type'), MINERVA('Note'));

      results.push({
        target: pathStmts[0]?.object.value ?? '',
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

export function backlinks(relativePath: string): Backlink[] {
  if (!store) return [];

  const target = noteUri(relativePath);
  const results: Backlink[] = [];

  for (const lt of LINK_TYPES) {
    const stmts = store.statementsMatching(undefined, MINERVA(lt.predicate), target);
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

// ── Persistence & Export ────────────────────────────────────────────────────

export async function persistGraph(): Promise<void> {
  if (!store || !currentRootPath) return;

  const graphPath = path.join(currentRootPath, '.minerva', 'graph.ttl');
  const turtle = serializeGraph();
  await fs.writeFile(graphPath, turtle, 'utf-8');
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
