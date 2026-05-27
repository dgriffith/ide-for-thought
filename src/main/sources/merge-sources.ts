/**
 * Merge one Source into another (#90 part 2).
 *
 * Two source folders sometimes describe the same work: a paper ingested
 * first by URL (no DOI yet) then later by DOI ends up at two different
 * canonical ids when the first ingest didn't carry the DOI through.
 * Re-ingest's metadata-merge (#90 part 1) handles the case where the
 * second ingest *resolves* to the same canonical id. This command
 * handles the case where it doesn't — the user explicitly picks two
 * folders and asks for them to become one.
 *
 * Operation, in order:
 *   1. Parse src/meta.ttl into a SourceMetaUpdate.
 *   2. Merge into dest/meta.ttl (reuses #90 part 1 conservative merge:
 *      add when missing, never overwrite).
 *   3. Copy body.md / original.* from src → dest ONLY if dest lacks
 *      them. Dest's identity always wins.
 *   4. For every excerpt with thought:fromSource sources:src, rewrite
 *      the .ttl in-place to point at dest and re-index.
 *   5. Find every note citing src and rewrite [[cite::src]] → [[cite::dest]].
 *   6. Remove src from the graph + delete src folder on disk.
 *
 * Excerpt ids are globally unique within a project (the .ttl filename
 * IS the id), so collisions between src and dest can't arise.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Parser } from 'n3';
import * as graph from '../graph/index';
import * as notebaseFs from '../notebase/fs';
import { rewriteTypedIdLinks } from '../notebase/link-rewriting';
import { projectContext } from '../project-context-types';
import { mergeMetaTtl, type SourceMetaUpdate } from './source-merge';
import { rewriteCollectionMemberships } from './collections';

export interface MergeSourcesResult {
  destId: string;
  removedId: string;
  /** Excerpts whose fromSource pointer was rewritten src → dest. */
  excerptsMoved: number;
  /** Notes whose `[[cite::src]]` was rewritten to `[[cite::dest]]`. */
  notesRewritten: number;
  /** Predicate localnames added to dest's meta.ttl (`doi`, `publisher`, …). */
  metadataAdded: string[];
  /** Names of files copied src → dest because dest lacked them (`body.md`, `original.pdf`, …). */
  artifactsCopied: string[];
}

export class MergeSourcesError extends Error {
  constructor(message: string, public readonly code: MergeSourcesErrorCode) {
    super(message);
    this.name = 'MergeSourcesError';
  }
}

export type MergeSourcesErrorCode =
  | 'same-source'
  | 'source-not-found'
  | 'dest-not-found';

export async function mergeSources(
  rootPath: string,
  srcId: string,
  destId: string,
): Promise<MergeSourcesResult> {
  if (srcId === destId) {
    throw new MergeSourcesError('Cannot merge a source into itself.', 'same-source');
  }

  const sourcesDir = path.join(rootPath, '.minerva', 'sources');
  const srcDir = path.join(sourcesDir, srcId);
  const destDir = path.join(sourcesDir, destId);

  const srcMetaPath = path.join(srcDir, 'meta.ttl');
  const destMetaPath = path.join(destDir, 'meta.ttl');

  let srcMetaTtl: string;
  try {
    srcMetaTtl = await fs.readFile(srcMetaPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new MergeSourcesError(`Source "${srcId}" not found.`, 'source-not-found');
    }
    throw err;
  }
  let destMetaTtl: string;
  try {
    destMetaTtl = await fs.readFile(destMetaPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new MergeSourcesError(`Destination source "${destId}" not found.`, 'dest-not-found');
    }
    throw err;
  }

  const ctx = projectContext(rootPath);

  // Excerpt ids are globally unique (filenames under .minerva/excerpts/)
  // so collision between src and dest can't naturally arise.
  const srcExcerpts = graph.excerptIdsForSource(ctx, srcId);

  // 1. Merge metadata.
  const update = parseSourceMetaTtl(srcMetaTtl);
  const { ttl: mergedDestTtl, added } = mergeMetaTtl(destMetaTtl, update);
  if (added.length > 0) {
    await fs.writeFile(destMetaPath, mergedDestTtl, 'utf-8');
  }

  // 2. Copy artifacts dest is missing. body.md + original.* only — we
  //    don't sweep the whole folder so that hand-added scratch files in
  //    src don't pollute dest.
  const artifactsCopied: string[] = [];
  for (const name of ['body.md', 'original.html', 'original.pdf']) {
    const srcPath = path.join(srcDir, name);
    const destPath = path.join(destDir, name);
    try {
      await fs.access(destPath);
      continue; // dest already has it — keep dest's
    } catch { /* dest missing — proceed */ }
    try {
      await fs.copyFile(srcPath, destPath);
      artifactsCopied.push(name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // src doesn't have it either — nothing to copy.
    }
  }

  // If dest got a new body.md, re-index it so the graph picks up the body.
  if (artifactsCopied.includes('body.md') || added.length > 0) {
    const finalMeta = await fs.readFile(destMetaPath, 'utf-8');
    let body: string | undefined;
    try { body = await fs.readFile(path.join(destDir, 'body.md'), 'utf-8'); } catch { /* ok */ }
    graph.indexSource(ctx, destId, finalMeta, body);
  }

  // 3. Move excerpts: rewrite each .ttl's `thought:fromSource sources:src`
  //    to point at dest and re-index.
  let excerptsMoved = 0;
  for (const excerptId of srcExcerpts) {
    const excerptPath = path.join(rootPath, '.minerva', 'excerpts', `${excerptId}.ttl`);
    try {
      const original = await fs.readFile(excerptPath, 'utf-8');
      const rewritten = rewriteExcerptFromSource(original, srcId, destId);
      if (rewritten !== original) {
        await fs.writeFile(excerptPath, rewritten, 'utf-8');
      }
      graph.removeExcerpt(ctx, excerptId);
      graph.indexExcerpt(ctx, excerptId, rewritten);
      excerptsMoved++;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
  }

  // 4. Rewrite [[cite::src]] → [[cite::dest]] in every referring note.
  const referringNotes = graph.findNotesCitingSource(ctx, srcId);
  const rewrites = new Map([[srcId, destId]]);
  let notesRewritten = 0;
  for (const notePath of referringNotes) {
    try {
      const content = await notebaseFs.readFile(rootPath, notePath);
      const next = rewriteTypedIdLinks(content, 'cite', rewrites);
      if (next === content) continue;
      await notebaseFs.writeFile(rootPath, notePath, next);
      await graph.indexNote(ctx, notePath, next);
      notesRewritten++;
    } catch (err) {
      console.error(`[minerva] cite rewrite failed for ${notePath}:`, err instanceof Error ? err.message : err);
    }
  }

  // 5. Move collection memberships src → dest (#470) so the dest
  //    inherits every "Reading list" / "Lit review" the src was in.
  await rewriteCollectionMemberships(rootPath, srcId, destId);

  // 6. Drop src from graph + disk.
  graph.removeSource(ctx, srcId);
  await fs.rm(srcDir, { recursive: true, force: true });

  return {
    destId,
    removedId: srcId,
    excerptsMoved,
    notesRewritten,
    metadataAdded: added,
    artifactsCopied,
  };
}

/**
 * Pull the fields a SourceMetaUpdate consumes out of a meta.ttl string.
 * Uses n3 so escaped quotes inside abstracts and unconventional
 * whitespace from hand edits don't break us. The on-disk meta.ttl
 * relies on project-global prefix declarations, so we inline the
 * subset we need before handing the string to the parser.
 */
const META_TTL_PREAMBLE =
  '@prefix this: <https://minerva.dev/this/> .\n' +
  '@prefix dc: <http://purl.org/dc/terms/> .\n' +
  '@prefix bibo: <http://purl.org/ontology/bibo/> .\n' +
  '@prefix schema: <http://schema.org/> .\n' +
  '@prefix thought: <https://minerva.dev/ontology/thought#> .\n' +
  '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n';

function parseSourceMetaTtl(ttl: string): SourceMetaUpdate {
  const parser = new Parser();
  const quads = parser.parse(META_TTL_PREAMBLE + ttl);

  const pred = (suffix: string, namespace: string): ((q: { predicate: { value: string } }) => boolean) =>
    (q) => q.predicate.value === namespace + suffix;
  const DC_NS = 'http://purl.org/dc/terms/';
  const BIBO_NS = 'http://purl.org/ontology/bibo/';
  const SCHEMA_NS = 'http://schema.org/';

  const firstObj = (matcher: (q: { predicate: { value: string } }) => boolean): string | null => {
    for (const q of quads) if (matcher(q)) return q.object.value;
    return null;
  };
  const allObj = (matcher: (q: { predicate: { value: string } }) => boolean): string[] => {
    const out: string[] = [];
    for (const q of quads) if (matcher(q)) out.push(q.object.value);
    return out;
  };

  return {
    doi: firstObj(pred('doi', BIBO_NS)),
    isbn: firstObj(pred('isbn', BIBO_NS)),
    uri: firstObj(pred('uri', BIBO_NS)),
    issued: firstObj(pred('issued', DC_NS)),
    publisher: firstObj(pred('publisher', DC_NS)),
    containerTitle: firstObj(pred('inContainer', SCHEMA_NS)),
    abstract: firstObj(pred('abstract', DC_NS)),
    creators: allObj(pred('creator', DC_NS)),
  };
}

/**
 * Rewrite `thought:fromSource sources:srcId` → `… sources:destId` in an
 * excerpt .ttl. Handles surrounding whitespace + comma-continuation
 * (`fromSource sources:foo, sources:bar` is legal but our writer doesn't
 * emit it; we still tolerate it for hand edits).
 */
export function rewriteExcerptFromSource(ttl: string, srcId: string, destId: string): string {
  // Match `sources:<srcId>` where srcId is preceded by `sources:` and
  // followed by a non-identifier char (semicolon, comma, whitespace, `.`).
  const escaped = srcId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(sources:)${escaped}(?=[\\s,;.]|$)`, 'g');
  return ttl.replace(re, `$1${destId}`);
}
