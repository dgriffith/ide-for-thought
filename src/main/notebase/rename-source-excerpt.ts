import fs from 'node:fs/promises';
import path from 'node:path';
import * as notebaseFs from './fs';
import { rewriteTypedIdLinks } from './link-rewriting';
import * as graph from '../graph/index';

export interface RenameIdOptions {
  markPathHandled?: (relativePath: string) => void;
  reindexHook?: (relativePath: string, content: string) => void;
}

export interface RenameIdResult {
  rewrittenPaths: string[];
}

/**
 * Rename a Source: rename the directory under `.minerva/sources/`, shift
 * the graph entry to the new id, and rewrite every `[[cite::oldId]]` in
 * the thoughtbase to `[[cite::newId]]`.
 */
export async function renameSource(
  rootPath: string,
  oldId: string,
  newId: string,
  opts: RenameIdOptions = {},
): Promise<RenameIdResult> {
  if (oldId === newId) return { rewrittenPaths: [] };
  const { markPathHandled, reindexHook } = opts;

  const oldDir = path.join(rootPath, '.minerva', 'sources', oldId);
  const newDir = path.join(rootPath, '.minerva', 'sources', newId);

  // Collect referring notes BEFORE the graph changes — query the old id.
  const referringNotes = graph.findNotesCitingSource(oldId);

  // Rename on disk.
  await fs.mkdir(path.dirname(newDir), { recursive: true });
  await fs.rename(oldDir, newDir);

  // Swap graph: remove old, index new.
  graph.removeSource(oldId);
  try {
    const metaContent = await fs.readFile(path.join(newDir, 'meta.ttl'), 'utf-8');
    let bodyContent: string | undefined;
    try {
      bodyContent = await fs.readFile(path.join(newDir, 'body.md'), 'utf-8');
    } catch { /* body optional */ }
    graph.indexSource(newId, metaContent, bodyContent);
  } catch {
    // meta.ttl missing — source is effectively removed as far as the graph is concerned.
  }

  return rewriteReferringNotes(
    rootPath,
    referringNotes,
    'cite',
    new Map([[oldId, newId]]),
    markPathHandled,
    reindexHook,
  );
}

/**
 * Rename an Excerpt: rename the `.ttl` file under `.minerva/excerpts/`,
 * shift the graph entry, and rewrite every `[[quote::oldId]]` to
 * `[[quote::newId]]` across the thoughtbase.
 */
export async function renameExcerpt(
  rootPath: string,
  oldId: string,
  newId: string,
  opts: RenameIdOptions = {},
): Promise<RenameIdResult> {
  if (oldId === newId) return { rewrittenPaths: [] };
  const { markPathHandled, reindexHook } = opts;

  const oldPath = path.join(rootPath, '.minerva', 'excerpts', `${oldId}.ttl`);
  const newPath = path.join(rootPath, '.minerva', 'excerpts', `${newId}.ttl`);

  const referringNotes = graph.findNotesQuotingExcerpt(oldId);

  await fs.mkdir(path.dirname(newPath), { recursive: true });
  await fs.rename(oldPath, newPath);

  graph.removeExcerpt(oldId);
  try {
    const content = await fs.readFile(newPath, 'utf-8');
    graph.indexExcerpt(newId, content);
  } catch {
    // ttl missing — excerpt removed.
  }

  return rewriteReferringNotes(
    rootPath,
    referringNotes,
    'quote',
    new Map([[oldId, newId]]),
    markPathHandled,
    reindexHook,
  );
}

async function rewriteReferringNotes(
  rootPath: string,
  referringNotes: string[],
  linkTypeName: 'cite' | 'quote',
  rewrites: Map<string, string>,
  markPathHandled?: (relativePath: string) => void,
  reindexHook?: (relativePath: string, content: string) => void,
): Promise<RenameIdResult> {
  const rewrittenPaths: string[] = [];
  for (const notePath of referringNotes) {
    try {
      const content = await notebaseFs.readFile(rootPath, notePath);
      const rewritten = rewriteTypedIdLinks(content, linkTypeName, rewrites);
      if (rewritten === content) continue;
      markPathHandled?.(notePath);
      await notebaseFs.writeFile(rootPath, notePath, rewritten);
      await graph.indexNote(notePath, rewritten);
      reindexHook?.(notePath, rewritten);
      rewrittenPaths.push(notePath);
    } catch (err) {
      console.error(`[minerva] ${linkTypeName} rewrite failed for ${notePath}:`, err instanceof Error ? err.message : err);
    }
  }
  return { rewrittenPaths };
}
