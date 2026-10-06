/**
 * Merge one tag into another across the whole thoughtbase (#2430) — which is
 * also how a tag is renamed: merging into a name nobody uses yet.
 *
 * What moves (the content rules live in `shared/refactor/merge-tag.ts`):
 *   - notes: frontmatter `tags:` (deduped) and inline `#tags`, including the
 *     nested ones under the prefix (`#ml/nlp` → `#machine-learning/nlp`);
 *   - sources: the `minerva:tag` / `minerva:upstreamTag` lines in each
 *     source's `meta.ttl`, through the same pure line helpers
 *     `SOURCES_ADD_TAG` / `SOURCES_REMOVE_TAG` use. An upstream tag that moves
 *     becomes a user tag: it is the user's name for it now, and "Strip
 *     upstream tags" should not take it away.
 *
 * What doesn't: a `#hashtag` inside a source's captured text (`body.md`).
 * That is the record of what the source said, not the user's tagging, so the
 * merge leaves it and the preview counts it (`sourcesBodyOnly`) so the
 * confirm can say so.
 *
 * Candidates come from the graph — notes and sources with a tag at or under
 * `from` — the same way note merge finds its referrers; the renderer flushes
 * autosave before asking. Each note is written through the standard write
 * pipeline (graph + search + embeddings reindex) under a history source, so
 * every rewritten note gets a Local History revision named after the merge,
 * and its pre-merge text is captured first. That is the undo (#1158).
 *
 * Electron-free: the caller passes the write-pipeline hooks and does the
 * broadcasts, like `multi-file-history.ts`.
 */
import fs from 'node:fs/promises';
import * as notebaseFs from '../notebase/fs';
import { writeAndReindex, type WritePipelineHooks } from '../notebase/write-pipeline';
import * as graph from '../graph/index';
import * as history from '../history';
import { projectContext } from '../project-context-types';
import {
  addTagLine,
  readMeta,
  reindexSource,
  removeTagLines,
  sourceMetaPath,
} from '../sources/source-meta-write';
import {
  assertTagMerge,
  cleanTagInput,
  mergeTagInContent,
  retargetTag,
  type TagMergePreview,
  type TagMergeResult,
} from '../../shared/refactor/merge-tag';

interface MergeTargets {
  from: string;
  to: string;
  /** Every live tag name at or under `from`. */
  tagNames: string[];
  notePaths: string[];
  sourceIds: string[];
  isRename: boolean;
}

function collectTargets(rootPath: string, fromRaw: string, toRaw: string): MergeTargets {
  const from = cleanTagInput(fromRaw);
  const to = cleanTagInput(toRaw);
  assertTagMerge(from, to);
  const ctx = projectContext(rootPath);
  // `listTags` reads live `hasTag` edges; `allTags` also returns tag nodes no
  // note uses any more, which would make a rename look like a merge.
  const live = graph.listTags(ctx).map((t) => t.tag);
  const tagNames = live.filter((t) => retargetTag(t, from, to) !== null);
  const notePaths = graph.notesByTagPrefix(ctx, from).map((n) => n.relativePath);
  const sourceIds = new Set<string>();
  for (const name of tagNames) {
    for (const s of graph.sourcesByTag(ctx, name)) sourceIds.add(s.sourceId);
  }
  return { from, to, tagNames, notePaths, sourceIds: [...sourceIds], isRename: !live.includes(to) };
}

/**
 * Pure: move every `minerva:tag` / `minerva:upstreamTag` line naming one of
 * `tagNames` to its merged name. `addTagLine` skips a tag the source already
 * has, which is the dedupe. Exposed for tests.
 */
export function mergeTagInMeta(ttl: string, tagNames: readonly string[], from: string, to: string): { ttl: string; changed: boolean } {
  let next = ttl;
  let changed = false;
  for (const name of tagNames) {
    const target = retargetTag(name, from, to);
    if (target === null) continue;
    const removed = removeTagLines(next, name);
    if (!removed.removed) continue;
    next = addTagLine(removed.ttl, target).ttl;
    changed = true;
  }
  return { ttl: next, changed };
}

/** Count what a merge would change, writing nothing. */
export async function previewTagMerge(rootPath: string, fromRaw: string, toRaw: string): Promise<TagMergePreview> {
  const t = collectTargets(rootPath, fromRaw, toRaw);
  let notes = 0;
  for (const rel of t.notePaths) {
    const content = await notebaseFs.readFile(rootPath, rel);
    if (mergeTagInContent(content, t.from, t.to).changed) notes++;
  }
  let sources = 0;
  let sourcesBodyOnly = 0;
  for (const id of t.sourceIds) {
    const ttl = await readMeta(sourceMetaPath(rootPath, id));
    if (mergeTagInMeta(ttl, t.tagNames, t.from, t.to).changed) sources++;
    else sourcesBodyOnly++;
  }
  const nestedTags = t.tagNames.filter((n) => n !== t.from).sort();
  return { notes, sources, sourcesBodyOnly, nestedTags, isRename: t.isRename };
}

/**
 * Merge `from` into `to`. Keeps going past a note or source that fails (read
 * error, unwritable file, a pre-merge history capture that couldn't be saved
 * — the note is then left untouched rather than overwritten without an undo)
 * and reports it in `errors`. Throws only for an invalid request.
 *
 * The caller broadcasts `notePaths` (NOTEBASE_REWRITTEN) and, when
 * `sourceIds` is non-empty, SOURCES_CHANGED, then persists the indexes.
 */
export async function mergeTag(
  rootPath: string,
  fromRaw: string,
  toRaw: string,
  hooks: WritePipelineHooks,
): Promise<TagMergeResult> {
  const t = collectTargets(rootPath, fromRaw, toRaw);
  const cause = `Merged #${t.from} into #${t.to}`;
  const result: TagMergeResult = { notePaths: [], sourceIds: [], errors: [] };

  for (const rel of t.notePaths) {
    try {
      const content = await notebaseFs.readFile(rootPath, rel);
      const merged = mergeTagInContent(content, t.from, t.to);
      if (!merged.changed) continue;
      // An edit made outside the app may not be in history yet. Keep it, so
      // the merge is undoable; this throws rather than lose it.
      await history.captureBeforeOverwrite(rootPath, rel, `Before merging #${t.from} into #${t.to}`);
      await history.runWithHistorySource({ origin: 'edit', cause }, () =>
        writeAndReindex(rootPath, rel, merged.content, hooks, {
          // One broadcast and one persist for the whole batch, by the caller.
          suppressRewrittenBroadcast: true,
          skipPersist: true,
        }));
      result.notePaths.push(rel);
    } catch (err) {
      result.errors.push({ path: rel, error: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const id of t.sourceIds) {
    const metaPath = sourceMetaPath(rootPath, id);
    try {
      const ttl = await readMeta(metaPath);
      const merged = mergeTagInMeta(ttl, t.tagNames, t.from, t.to);
      if (!merged.changed) continue;
      await fs.writeFile(metaPath, merged.ttl, 'utf-8');
      await reindexSource(rootPath, id);
      result.sourceIds.push(id);
    } catch (err) {
      result.errors.push({ path: `source ${id}`, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
