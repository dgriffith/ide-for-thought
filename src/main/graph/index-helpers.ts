/**
 * Low-level graph-indexing helpers shared across the per-format indexers
 * (note / source / excerpt / tables). Extracted from indexers.ts (#1624) so the
 * per-format modules can import them without depending on the large indexers.ts
 * — keeping the split acyclic. Depends only on `./state` (a leaf).
 */
import fsSync from 'node:fs';
import path from 'node:path';
import { STANDARD_PREFIXES, type GraphState } from './state';

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
