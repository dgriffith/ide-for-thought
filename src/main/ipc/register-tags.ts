import { Channels } from '../../shared/channels';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { mergeTag, previewTagMerge } from '../tags/merge-tags';
import {
  withRootPath, withRootPathOr, persistIndexes, broadcastRewritten, broadcastSourcesChanged, hooks,
} from './helpers';
import { handle } from './typed-ipc';

export function registerTags(): void {
  // Tags
  handle(Channels.TAGS_LIST, withRootPathOr([], (rootPath) =>
    graph.listTags(projectContext(rootPath))));

  handle(Channels.TAGS_NOTES_BY_TAG, withRootPathOr([], (rootPath, tag: string) =>
    graph.notesByTag(projectContext(rootPath), tag)));

  handle(Channels.TAGS_NOTES_BY_TAG_PREFIX, withRootPathOr([], (rootPath, prefix: string) =>
    graph.notesByTagPrefix(projectContext(rootPath), prefix)));

  handle(Channels.TAGS_SOURCES_BY_TAG, withRootPathOr([], (rootPath, tag: string) =>
    graph.sourcesByTag(projectContext(rootPath), tag)));

  handle(Channels.TAGS_ALL_NAMES, withRootPathOr([], (rootPath) =>
    graph.allTags(projectContext(rootPath))));

  // Merge / rename a tag (#2430). `withRootPath`, not `…Or`: with no project
  // there is nothing to count or merge, and "0 notes" would read as an answer.
  handle(Channels.TAGS_MERGE_PREVIEW, withRootPath((rootPath, from: string, to: string) =>
    previewTagMerge(rootPath, from, to)));

  handle(Channels.TAGS_MERGE, withRootPath(async (rootPath, from: string, to: string) => {
    const result = await mergeTag(rootPath, from, to, hooks);
    // Same tail as the other bulk rewrites (replace-in-notes, note merge):
    // one NOTEBASE_REWRITTEN so open tabs reload, one persist for the batch.
    broadcastRewritten(rootPath, result.notePaths);
    if (result.sourceIds.length > 0) broadcastSourcesChanged(rootPath);
    await persistIndexes(rootPath);
    return result;
  }));
}
