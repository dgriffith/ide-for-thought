/**
 * Excerpt indexing (#1624 — split by format out of indexers.ts).
 *
 * An "excerpt" is a verbatim quotation lifted from a Source, stored at
 * `.minerva/excerpts/<id>.ttl`. The excerpt node's URI is `${baseUri}excerpt/<id>`.
 * Inside the .ttl file, `this:` resolves to that URI and `sources:` resolves to
 * `${baseUri}source/`, so users can write:
 *   this: a thought:Excerpt ;
 *       thought:fromSource sources:smith-2023 ;
 *       thought:citedText "..." ;
 *       thought:page 42 .
 */
import * as $rdf from 'rdflib';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as uriHelpers from '../uri-helpers';
import type { ProjectContext } from '../../project-context-types';
import {
  getState, invalidate,
  MINERVA, DC, THOUGHT,
  projectUri, sourceUri, excerptUri, dateLit,
} from '../state';
import { checkLLMWriteGuard } from '../write-guard';
import { fileMtimeIso, injectPrefixes } from '../index-helpers';
import { logger } from '../../../shared/logger';

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
    logger('graph').error(`Failed to parse excerpt ttl for ${excerptId}:`, e instanceof Error ? e.message : e);
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

/** Walk `.minerva/excerpts/*.ttl` and index each — the excerpt half of a full
 *  `indexAllNotes` pass. Returns the count indexed. */
export async function walkAndIndexExcerpts(ctx: ProjectContext, rootPath: string): Promise<number> {
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
