import fs from 'node:fs/promises';
import path from 'node:path';
import * as notebaseFs from './fs';
import { rewriteWikiLinks, normalizePath as normalizeLinkPath } from './link-rewriting';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { isIndexable } from './indexable-files';

async function listIndexableFiles(rootPath: string, relDir: string): Promise<string[]> {
  const results: string[] = [];
  const absDir = path.join(rootPath, relDir);
  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...await listIndexableFiles(rootPath, rel));
      } else if (isIndexable(entry.name)) {
        results.push(rel);
      }
    }
  } catch { /* directory may not exist */ }
  return results;
}

export interface RenameWithLinksOptions {
  /** Called for every relative path we're about to touch so the watcher can dedupe. Optional. */
  markPathHandled?: (relativePath: string) => void;
  /** Called with (relativePath, content) after each reindex so additional indexes (e.g. search) can update. Optional. */
  reindexHook?: (relativePath: string, content: string) => void;
  /** Called with relativePath after each removal from the graph. Optional. */
  removeHook?: (relativePath: string) => void;
}

export interface PathTransition {
  old: string;
  new: string;
}

export interface RenameResult {
  /** One transition per renamed indexable file (a single entry for file renames; many for folder renames). */
  transitions: PathTransition[];
  /** Paths of OTHER notes whose content was rewritten by the pass. */
  rewrittenPaths: string[];
}

/**
 * Rename a note file or folder and rewrite every wiki-link in the thoughtbase
 * that pointed at the old location.
 *
 * Callers are responsible for persisting the graph after this resolves.
 */
export async function renameWithLinkRewrites(
  rootPath: string,
  oldRelPath: string,
  newRelPath: string,
  opts: RenameWithLinksOptions = {},
): Promise<RenameResult> {
  const { markPathHandled, reindexHook, removeHook } = opts;
  const ctx = projectContext(rootPath);

  // Determine whether this is a directory rename BEFORE the fs.rename call
  // so we can enumerate descendants at the old location.
  const oldStat = await fs.stat(path.join(rootPath, oldRelPath));
  const isDirectory = oldStat.isDirectory();

  // Build the rewrites map: normalized-old-path → normalized-new-path.
  const rewrites = new Map<string, string>();
  if (isDirectory) {
    const descendants = await listIndexableFiles(rootPath, oldRelPath);
    for (const d of descendants) {
      const newEquivalent = newRelPath + d.slice(oldRelPath.length);
      rewrites.set(normalizeLinkPath(d), normalizeLinkPath(newEquivalent));
    }
  } else if (isIndexable(oldRelPath)) {
    rewrites.set(normalizeLinkPath(oldRelPath), normalizeLinkPath(newRelPath));
  }

  // Compute referring notes BEFORE renaming (querying pre-rename graph state).
  const referringNotes = new Set<string>();
  for (const oldPath of rewrites.keys()) {
    for (const p of graph.findNotesLinkingTo(ctx, `${oldPath}.md`)) {
      referringNotes.add(p);
    }
  }

  markPathHandled?.(oldRelPath);
  markPathHandled?.(newRelPath);
  await notebaseFs.rename(rootPath, oldRelPath, newRelPath);

  // Re-index the renamed file(s) at their new location, recording transitions.
  const transitions: PathTransition[] = [];
  if (isDirectory) {
    const newFiles = await listIndexableFiles(rootPath, newRelPath);
    for (const f of newFiles) {
      const oldEquivalent = oldRelPath + f.slice(newRelPath.length);
      if (isIndexable(oldEquivalent)) {
        graph.removeNote(ctx, oldEquivalent);
        removeHook?.(oldEquivalent);
      }
      if (isIndexable(f)) {
        const content = await notebaseFs.readFile(rootPath, f);
        await graph.indexNote(ctx, f, content);
        reindexHook?.(f, content);
        transitions.push({ old: oldEquivalent, new: f });
      }
    }
  } else if (isIndexable(oldRelPath)) {
    graph.removeNote(ctx, oldRelPath);
    removeHook?.(oldRelPath);
    const content = await notebaseFs.readFile(rootPath, newRelPath);
    await graph.indexNote(ctx, newRelPath, content);
    reindexHook?.(newRelPath, content);
    transitions.push({ old: oldRelPath, new: newRelPath });
  }

  // Rewrite wiki-links in every referring note. If a referring note was itself
  // inside the renamed folder, translate its old path to the new one first.
  const rewrittenPaths: string[] = [];
  for (const notePath of referringNotes) {
    const normalized = normalizeLinkPath(notePath);
    const rewrittenBase = rewrites.get(normalized);
    const actualPath = rewrittenBase !== undefined ? `${rewrittenBase}.md` : notePath;
    try {
      const content = await notebaseFs.readFile(rootPath, actualPath);
      const rewritten = rewriteWikiLinks(content, rewrites);
      if (rewritten !== content) {
        markPathHandled?.(actualPath);
        await notebaseFs.writeFile(rootPath, actualPath, rewritten);
        await graph.indexNote(ctx, actualPath, rewritten);
        reindexHook?.(actualPath, rewritten);
        rewrittenPaths.push(actualPath);
      }
    } catch (err) {
      console.error(`[minerva] Link rewrite failed for ${actualPath}:`, err instanceof Error ? err.message : err);
    }
  }

  return { transitions, rewrittenPaths };
}
