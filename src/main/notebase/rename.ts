import fs from 'node:fs/promises';
import path from 'node:path';
import * as notebaseFs from './fs';
import {
  rewriteWikiLinks,
  rewriteRelativeMarkdownLinks,
  normalizePath as normalizeLinkPath,
} from './link-rewriting';
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

/**
 * List every file (any extension) under `relDir`, used to build the
 * markdown-rewrites map. The wiki-link rewriter cares only about
 * indexable notes, but markdown image refs can target .png/.svg/.csv
 * etc — those need to be in the rewrites map so a sibling note's
 * `![alt](pic.png)` gets re-relativized when the folder moves.
 */
async function listAllFiles(rootPath: string, relDir: string): Promise<string[]> {
  const results: string[] = [];
  const absDir = path.join(rootPath, relDir);
  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...await listAllFiles(rootPath, rel));
      } else {
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

  // Build the wiki-link rewrites map: normalized-old-path → normalized-new-path.
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

  // Markdown-link rewrites map: full-path → full-path. Covers every
  // file moved by this rename (indexable or not), since a sibling
  // note's `![alt](pic.png)` needs re-relativizing when `pic.png`
  // moves alongside it. The wiki-link map above is a strict subset
  // of this one (md-files only, with the `.md` suffix stripped).
  const mdRewrites = new Map<string, string>();
  if (isDirectory) {
    const descendants = await listAllFiles(rootPath, oldRelPath);
    for (const d of descendants) {
      mdRewrites.set(d, newRelPath + d.slice(oldRelPath.length));
    }
  } else {
    mdRewrites.set(oldRelPath, newRelPath);
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

  // Rewrite links across the project. Two rewriters run in one pass:
  //   - wiki-link rewriter (graph-driven): only referring notes need a
  //     pass, since wiki-link targets are root-relative.
  //   - markdown-link rewriter (whole-project sweep): authored relative
  //     paths can target moved files OR live inside a moved file —
  //     both directions need re-relativization, and the graph doesn't
  //     index markdown-link edges, so we walk every indexable note.
  // Both passes share a single read/write cycle per file so we don't
  // double-write notes that both passes would touch.
  const rewrittenPaths: string[] = [];
  const allNotes = await listIndexableFiles(rootPath, '');
  for (const currentPath of allNotes) {
    // The note's path BEFORE the rename. For files moved as part of
    // this rename, that's their pre-rename location; otherwise it's
    // unchanged. Markdown links are resolved against the OLD source
    // location since that's where the author wrote them.
    const oldEquivalent = isDirectory && currentPath.startsWith(`${newRelPath}/`)
      ? oldRelPath + currentPath.slice(newRelPath.length)
      : currentPath === newRelPath
        ? oldRelPath
        : currentPath;

    let content: string;
    try {
      content = await notebaseFs.readFile(rootPath, currentPath);
    } catch (err) {
      console.error(`[minerva] Read for rewrite failed for ${currentPath}:`, err instanceof Error ? err.message : err);
      continue;
    }

    let rewritten = content;

    // Wiki-link pass — only useful when this note actually refers to
    // one of the moved targets. The graph-driven set tells us which.
    if (referringNotes.has(oldEquivalent)) {
      rewritten = rewriteWikiLinks(rewritten, rewrites);
    }

    // Markdown-link pass — applies whenever the source moved (so all
    // its relative links need re-relativizing) OR a target moved (so
    // a link in this note may need its target updated). The rewriter
    // itself is a fast no-op when neither condition fires for this
    // file's content.
    rewritten = rewriteRelativeMarkdownLinks(
      rewritten,
      oldEquivalent,
      currentPath,
      mdRewrites,
    );

    if (rewritten !== content) {
      try {
        markPathHandled?.(currentPath);
        await notebaseFs.writeFile(rootPath, currentPath, rewritten);
        await graph.indexNote(ctx, currentPath, rewritten);
        reindexHook?.(currentPath, rewritten);
        rewrittenPaths.push(currentPath);
      } catch (err) {
        console.error(`[minerva] Link rewrite failed for ${currentPath}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return { transitions, rewrittenPaths };
}
