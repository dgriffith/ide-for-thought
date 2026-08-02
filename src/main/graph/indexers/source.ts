/**
 * Source indexing (#1624 — split by format out of indexers.ts).
 *
 * A "source" is a citable external work (Article, Book, WebPage, …) whose
 * canonical metadata lives at `.minerva/sources/<id>/meta.ttl`. The source
 * node's URI is `${baseUri}source/<id>`; inside meta.ttl, `this:` resolves to
 * that URI so users can write `this: a thought:Article ; dc:title ...`.
 */
import * as $rdf from 'rdflib';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as uriHelpers from '../uri-helpers';
import type { ProjectContext } from '../../project-context-types';
import {
  getState, invalidate,
  MINERVA, DC,
  projectUri, sourceUri, tagUri, dateLit, linkPredicate,
  type GraphState,
} from '../state';
import { getLinkType } from '../../../shared/link-types';
import { parseMarkdown } from '../parser';
import { checkLLMWriteGuard } from '../write-guard';
import {
  fileMtimeIso, injectPrefixes,
  ensureTag, flattenFrontmatterStrings,
  buildLinkResolveCtx, resolveLinkTarget,
} from '../index-helpers';

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

  // Upstream subject tags (#473). Each `minerva:upstreamTag "..."` literal
  // becomes a real `minerva:hasTag` edge, mirroring the body-tag pipeline so a
  // CrossRef-imported tag and a hand-authored body tag look the same.
  for (const st of store.statementsMatching(subject, MINERVA('upstreamTag'), undefined, graph)) {
    const name = st.object.value;
    if (!name) continue;
    const tagNode = tagUri(state, name);
    ensureTag(state, tagNode, name);
    store.add(subject, MINERVA('hasTag'), tagNode, graph);
  }

  // User-added tags (#766). Each `minerva:tag "..."` literal becomes a hasTag
  // edge too. Distinct predicate from upstreamTag so "Strip upstream tags"
  // leaves the user's own tags alone.
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
  const linkCtx = buildLinkResolveCtx(state);
  for (const link of parsed.links) {
    const linkType = getLinkType(link.type);
    const predicate = linkPredicate(linkType);
    const targetNode = resolveLinkTarget(state, linkType, link.target, linkCtx, link.anchor);
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

/** Walk `.minerva/sources/<id>/meta.ttl` (+ optional body.md) and index each —
 *  the source half of a full `indexAllNotes` pass. Returns the count indexed. */
export async function walkAndIndexSources(ctx: ProjectContext, rootPath: string): Promise<number> {
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
