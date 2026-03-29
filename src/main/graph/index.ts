import * as $rdf from 'rdflib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseMarkdown } from './parser';

const IFT = $rdf.Namespace('https://minerva.dev/ns#');
const DC = $rdf.Namespace('http://purl.org/dc/terms/');
const RDF = $rdf.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');

let store: $rdf.IndexedFormula | null = null;
let currentRootPath: string | null = null;

function noteUri(slug: string): $rdf.NamedNode {
  return $rdf.sym(`note:${slug}`);
}

function slugFromPath(relativePath: string): string {
  return relativePath.replace(/\.md$/, '').replace(/\//g, '--');
}

export async function initGraph(rootPath: string): Promise<void> {
  store = $rdf.graph();
  currentRootPath = rootPath;

  const metaDir = path.join(rootPath, '.minerva');
  await fs.mkdir(metaDir, { recursive: true });

  // Load persisted graph if it exists
  const graphPath = path.join(metaDir, 'graph.ttl');
  try {
    const turtle = await fs.readFile(graphPath, 'utf-8');
    $rdf.parse(turtle, store, 'note:', 'text/turtle');
  } catch {
    // No persisted graph yet, start fresh
  }
}

export async function indexNote(relativePath: string, content: string): Promise<void> {
  if (!store) return;

  const slug = slugFromPath(relativePath);
  const subject = noteUri(slug);

  // Remove existing triples for this note
  store.removeMatches(subject, undefined, undefined);

  // Add type
  store.add(subject, RDF('type'), IFT('Note'));

  // Parse markdown
  const parsed = parseMarkdown(content);

  // Title
  const title = parsed.title ?? slug;
  store.add(subject, DC('title'), $rdf.lit(title));

  // File info
  store.add(subject, IFT('filename'), $rdf.lit(path.basename(relativePath)));
  store.add(subject, IFT('relativePath'), $rdf.lit(relativePath));

  // Timestamps
  store.add(subject, DC('modified'), $rdf.lit(new Date().toISOString(), undefined, $rdf.sym('http://www.w3.org/2001/XMLSchema#dateTime')));

  // Tags
  for (const tag of parsed.tags) {
    store.add(subject, IFT('tag'), $rdf.lit(tag));
  }

  // Wiki-links
  for (const link of parsed.links) {
    const targetSlug = slugFromPath(link.endsWith('.md') ? link : `${link}.md`);
    store.add(subject, IFT('linksTo'), noteUri(targetSlug));
  }

  // Frontmatter
  for (const [key, value] of Object.entries(parsed.frontmatter)) {
    if (key !== 'title') {
      store.add(subject, IFT(`meta-${key}`), $rdf.lit(value));
    }
  }
}

export async function indexAllNotes(rootPath: string): Promise<number> {
  if (!store) return 0;

  let count = 0;
  await walkAndIndex(rootPath, rootPath);
  await persistGraph();

  async function walkAndIndex(dirPath: string, root: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
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

export async function queryGraph(sparql: string): Promise<{ results: unknown[] }> {
  if (!store) return { results: [] };

  try {
    const query = $rdf.SPARQLToQuery(sparql, false, store);
    if (!query) return { results: [] };

    const results = store.querySync(query);
    // Convert results to plain objects
    const serialized = results.map((binding: Record<string, $rdf.Node>) => {
      const obj: Record<string, string> = {};
      for (const [key, value] of Object.entries(binding)) {
        if (value && typeof value.value === 'string') {
          obj[key] = value.value;
        }
      }
      return obj;
    });

    return { results: serialized };
  } catch (e) {
    return { results: [], error: String(e) } as any;
  }
}

import type { TagInfo, TaggedNote } from '../../shared/types';

export function listTags(): TagInfo[] {
  if (!store) return [];

  const tagCounts = new Map<string, number>();
  const stmts = store.statementsMatching(undefined, IFT('tag'), undefined);
  for (const st of stmts) {
    const tag = st.object.value;
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  return [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

export function notesByTag(tag: string): TaggedNote[] {
  if (!store) return [];

  const stmts = store.statementsMatching(undefined, IFT('tag'), $rdf.lit(tag));
  return stmts.map((st) => {
    const subject = st.subject;
    const titleStmts = store!.statementsMatching(subject, DC('title'), undefined);
    const pathStmts = store!.statementsMatching(subject, IFT('relativePath'), undefined);
    return {
      title: titleStmts[0]?.object.value ?? subject.value,
      relativePath: pathStmts[0]?.object.value ?? '',
    };
  }).filter((n) => n.relativePath);
}

export function allTags(): string[] {
  if (!store) return [];
  const tags = new Set<string>();
  const stmts = store.statementsMatching(undefined, IFT('tag'), undefined);
  for (const st of stmts) {
    tags.add(st.object.value);
  }
  return [...tags].sort();
}

export async function persistGraph(): Promise<void> {
  if (!store || !currentRootPath) return;

  const graphPath = path.join(currentRootPath, '.minerva', 'graph.ttl');
  const turtle = $rdf.serialize(undefined, store, 'note:', 'text/turtle') ?? '';
  await fs.writeFile(graphPath, turtle, 'utf-8');
}
