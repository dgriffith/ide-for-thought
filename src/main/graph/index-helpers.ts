/**
 * Low-level graph-indexing helpers shared across the per-format indexers
 * (note / source / excerpt / tables). Extracted from indexers.ts (#1624) so the
 * per-format modules can import them without depending on the large indexers.ts
 * — keeping the split acyclic. Depends only on leaf modules (state / parser /
 * shared).
 */
import * as $rdf from 'rdflib';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  STANDARD_PREFIXES, RDF, MINERVA, DC,
  noteUri, sourceUri, excerptUri, folderUri, projectUri,
  type GraphState,
} from './state';
import { buildWikiLinkIndex, resolveWikiLinkTargetWithIndex, type WikiLinkIndex } from '../../shared/wiki-link-resolver';
import type { LinkType } from '../../shared/link-types';
import type { FrontmatterValue } from './parser';
import { slugify } from '../../shared/slug';

/** Disk mtime of a note/source/excerpt file as an ISO string; falls back to
 *  `now()` when the file can't be stat'd (#336). */
export function fileMtimeIso(state: GraphState, relativePath: string): string {
  try {
    return fsSync.statSync(path.join(state.rootPath, relativePath)).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/** Prepend any missing standard + project-scoped (`sources:` / `excerpts:` /
 *  `this:`) `@prefix` declarations to a turtle block before it's parsed. */
export function injectPrefixes(state: GraphState, turtle: string, noteIri: string): string {
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

/** The wiki-link resolver index, built once per indexing pass so each
 *  `resolveLinkTarget` is an O(1) lookup rather than O(N) (#1473). */
export interface LinkResolveCtx {
  index: WikiLinkIndex;
}

export function buildLinkResolveCtx(state: GraphState): LinkResolveCtx {
  const files = [...state.indexedNotePaths].map((relativePath) => ({ relativePath, isDirectory: false }));
  // aliasMap keys are already lowercased by rebuildAliasMap.
  return { index: buildWikiLinkIndex(files, Object.fromEntries(state.aliasMap)) };
}

/** Resolve a wiki-link's target to its graph node — exactly as click-navigation
 *  does (#1142): exact path, then basename, then frontmatter alias, then
 *  slug-fuzzy; falling back to the literal target so a link to a not-yet-created
 *  note still lights up once the file lands. Anchors append as an IRI fragment. */
export function resolveLinkTarget(
  state: GraphState,
  lt: LinkType,
  target: string,
  rc: LinkResolveCtx,
  anchor?: string,
) {
  if (lt.targetKind === 'source') return sourceUri(state, target);
  if (lt.targetKind === 'excerpt') return excerptUri(state, target);
  const resolvedPath = resolveWikiLinkTargetWithIndex(target, rc.index)
    ?? (target.endsWith('.md') ? target : `${target}.md`);
  const base = noteUri(state, resolvedPath);
  if (!anchor) return base;
  // Headings become `#slug`; block-ids stay `#^raw-id` (unslugified so ids
  // survive edits on the referenced block).
  const frag = anchor.startsWith('^') ? anchor : slugify(anchor);
  return $rdf.sym(`${base.value}#${frag}`);
}

/** Flatten a frontmatter value to a list of strings — for multi-valued string
 *  keys like `tags`. */
export function flattenFrontmatterStrings(value: FrontmatterValue): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flattenFrontmatterStrings);
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (value instanceof Date) return [value.toISOString()];
  return [];
}

/** Ensure a `minerva:Tag` resource exists (idempotent) with its display name. */
export function ensureTag(state: GraphState, tagNode: $rdf.NamedNode, tagName: string): void {
  const { store } = state;
  const existing = store.statementsMatching(tagNode, RDF('type'), MINERVA('Tag'));
  if (existing.length === 0) {
    store.add(tagNode, RDF('type'), MINERVA('Tag'));
    store.add(tagNode, MINERVA('tagName'), $rdf.lit(tagName));
  }
}

/** Ensure a `minerva:Folder` resource exists (idempotent), nested under its
 *  parent folder — recursing up the path. Shared by note + file-type indexing. */
export function ensureFolder(state: GraphState, relativePath: string): void {
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
