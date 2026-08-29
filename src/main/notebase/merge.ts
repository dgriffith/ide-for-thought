import fs from 'node:fs/promises';
import path from 'node:path';
import * as notebaseFs from './fs';
import { rewriteWikiLinks, normalizePath as normalizeLinkPath } from './link-rewriting';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { isIndexable } from './indexable-files';
import { logger } from '../../shared/logger';

/**
 * Merge note (#464). Append the source note's body to a target note,
 * rewrite every wiki-link `[[source]]` across the project to point at
 * the target, and delete the source. Source frontmatter is dropped on
 * merge — the target keeps its own.
 *
 * Conceptually: the inverse of "extract selection to new note." Borrowed
 * from Obsidian's Note Composer plugin.
 *
 * Per CLAUDE.md, this is destructive-feeling but git-backed; the renderer
 * surfaces a single Confirm before invoking. Failure mid-flight leaves
 * the project in whatever state the partial writes produced — recovery
 * is `git reset --hard HEAD` per Minerva's git-as-undo model.
 */

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export interface MergePreview {
  /** Number of wiki-link occurrences across the project that will be
   *  rewritten from source → target. */
  linkOccurrences: number;
  /** Number of files that contain at least one such link. */
  affectedFiles: number;
}

export interface MergeResult {
  /** Final relative path of the merged target note (== `targetRelPath`). */
  targetPath: string;
  /** Character offset in the merged target where the source body begins.
   *  Renderer uses this to scroll the editor to the merge point. */
  mergeOffset: number;
  /** 1-based line number of the merge point. */
  mergeLine: number;
  /** Number of wiki-link occurrences rewritten. */
  rewrittenLinks: number;
  /** Other notes whose content was rewritten by the link-rewrite pass.
   *  Excludes the target itself (which always changed). */
  rewrittenPaths: string[];
  /** Source path that was deleted as part of the merge. */
  deletedSource: string;
}

export interface MergeOptions {
  /** Inserted between the target's existing content and the source body.
   *  Default `\n\n`. The merge point reported in `mergeOffset` is the
   *  position immediately AFTER this separator (i.e., where the source
   *  body actually starts). */
  separator?: string;
  /** Watcher dedupe hook — called for every relative path the merge
   *  will write to or delete. Optional. */
  markPathHandled?: (relativePath: string) => void;
  /** Called with `(relativePath, content)` after each reindex. Optional. */
  reindexHook?: (relativePath: string, content: string) => void;
  /** Called with `relativePath` after the source is removed from the graph. */
  removeHook?: (relativePath: string) => void;
}

/**
 * Cheap pre-flight count of how many notes / link occurrences would be
 * rewritten by a merge. The renderer surfaces this in the confirmation
 * dialog so the user knows the blast radius. Pure read; no mutation.
 */
export async function previewMergeNotes(
  rootPath: string,
  sourceRelPath: string,
  targetRelPath: string,
): Promise<MergePreview> {
  if (!isIndexable(sourceRelPath) || !isIndexable(targetRelPath)) {
    throw new Error('mergeNotes: source and target must both be indexable .md files.');
  }
  if (sourceRelPath === targetRelPath) {
    return { linkOccurrences: 0, affectedFiles: 0 };
  }

  const ctx = projectContext(rootPath);
  // Graph-driven reverse-link query — fast for the common case where
  // the source has only a handful of inbound links.
  const referring = graph.findNotesLinkingTo(ctx, sourceRelPath);
  let occurrences = 0;
  let files = 0;
  const sourceBase = normalizeLinkPath(sourceRelPath);
  const re = buildLinkOccurrenceRegex(sourceBase);
  for (const ref of referring) {
    if (ref === sourceRelPath) continue; // self-references will vanish with the file
    try {
      const content = await notebaseFs.readFile(rootPath, ref);
      const matches = content.match(re);
      if (matches && matches.length > 0) {
        occurrences += matches.length;
        files++;
      }
    } catch {
      // Read failure → file vanished or unreadable; skip silently.
    }
  }
  return { linkOccurrences: occurrences, affectedFiles: files };
}

/**
 * Compile a regex matching `[[<sourceBase>]]` and its variants
 * (`![[…]]`, `[[…|alias]]`, `[[…#anchor]]`, with or without `.md`).
 * Used only by `previewMergeNotes`; the actual rewrite delegates to
 * `rewriteWikiLinks` which has its own parser.
 */
function buildLinkOccurrenceRegex(sourceBase: string): RegExp {
  // Escape regex metachars in the path; allow optional .md, optional
  // anchor (#…), and optional alias (|…). The leading `[[` may be
  // preceded by `!` for embeds.
  const escaped = sourceBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`!?\\[\\[\\s*${escaped}(?:\\.md)?\\s*(?:#[^\\]|]*)?\\s*(?:\\|[^\\]]*)?\\]\\]`, 'g');
}

export async function mergeNotes(
  rootPath: string,
  sourceRelPath: string,
  targetRelPath: string,
  opts: MergeOptions = {},
): Promise<MergeResult> {
  if (!isIndexable(sourceRelPath) || !isIndexable(targetRelPath)) {
    throw new Error('mergeNotes: source and target must both be indexable .md files.');
  }
  if (sourceRelPath === targetRelPath) {
    throw new Error('mergeNotes: source and target are the same note.');
  }

  const separator = opts.separator ?? '\n\n';
  const ctx = projectContext(rootPath);

  const [sourceContent, targetContent] = await Promise.all([
    notebaseFs.readFile(rootPath, sourceRelPath),
    notebaseFs.readFile(rootPath, targetRelPath),
  ]);

  const sourceBody = stripFrontmatter(sourceContent);

  // Compose the merged target content. The merge point is the offset
  // where the source body begins — i.e., target length + separator
  // length. Use that to derive a 1-based line number for the renderer.
  const mergeOffset = targetContent.length + separator.length;
  const mergedContent = targetContent + separator + sourceBody;
  const mergeLine = countLines(mergedContent.slice(0, mergeOffset));

  // Build the link-rewrites map. `rewriteWikiLinks` keys are normalized
  // paths (no `.md`). After the rewrite, links pointing at the source
  // resolve to the target.
  const rewrites = new Map<string, string>();
  rewrites.set(normalizeLinkPath(sourceRelPath), normalizeLinkPath(targetRelPath));

  // Find the set of referrers via the graph; cheaper than walking every
  // note. The graph is up-to-date for saved files; unsaved buffers are
  // the renderer's responsibility (autoSave will have flushed them
  // before invoking, in the typical flow).
  const referringSet = new Set(graph.findNotesLinkingTo(ctx, sourceRelPath));
  // Drop the source itself — we're deleting it.
  referringSet.delete(sourceRelPath);
  // Drop the target — we'll rewrite its content separately (the merged
  // body may itself contain `[[source]]` self-references that should
  // become target self-references). Handled below.
  referringSet.delete(targetRelPath);

  // 1. Write the merged target. The merged content may contain
  //    `[[source]]` references inherited from the source body — rewrite
  //    those as part of the same write pass.
  const targetRewritten = rewriteWikiLinks(mergedContent, rewrites);
  opts.markPathHandled?.(targetRelPath);
  await notebaseFs.writeFile(rootPath, targetRelPath, targetRewritten);
  await graph.indexNote(ctx, targetRelPath, targetRewritten);
  opts.reindexHook?.(targetRelPath, targetRewritten);

  // 2. Rewrite links in every referring note. Count the total
  //    occurrences so the renderer can surface the number in its
  //    success toast.
  let rewrittenLinks = 0;
  const rewrittenPaths: string[] = [];
  for (const ref of referringSet) {
    let content: string;
    try {
      content = await notebaseFs.readFile(rootPath, ref);
    } catch (err) {
      logger('merge').error(`read failed for ${ref}:`, err instanceof Error ? err.message : err);
      continue;
    }
    const rewritten = rewriteWikiLinks(content, rewrites);
    if (rewritten === content) continue;
    // Count occurrences by diffing. Cheap and accurate enough — wiki-link
    // rewrites change exact substrings, so the regex pass is reliable.
    const before = content.match(buildLinkOccurrenceRegex(normalizeLinkPath(sourceRelPath)));
    rewrittenLinks += before?.length ?? 0;
    try {
      opts.markPathHandled?.(ref);
      await notebaseFs.writeFile(rootPath, ref, rewritten);
      await graph.indexNote(ctx, ref, rewritten);
      opts.reindexHook?.(ref, rewritten);
      rewrittenPaths.push(ref);
    } catch (err) {
      logger('merge').error(`write failed for ${ref}:`, err instanceof Error ? err.message : err);
    }
  }

  // 3. Delete the source. Last so a partial failure leaves the merged
  //    target + rewritten links + the source still around — recoverable
  //    by the user even without git.
  opts.markPathHandled?.(sourceRelPath);
  graph.removeNote(ctx, sourceRelPath);
  opts.removeHook?.(sourceRelPath);
  await fs.unlink(path.join(rootPath, sourceRelPath));

  return {
    targetPath: targetRelPath,
    mergeOffset,
    mergeLine,
    rewrittenLinks,
    rewrittenPaths,
    deletedSource: sourceRelPath,
  };
}

function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, '');
}

function countLines(s: string): number {
  // 1-based line number of the position at the end of `s`. Used to
  // place the editor cursor at the start of the merged-in section.
  let line = 1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n') line++;
  }
  return line;
}
