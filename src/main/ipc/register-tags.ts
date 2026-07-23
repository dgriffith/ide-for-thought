import { Channels } from '../../shared/channels';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { withRootPathOr } from './helpers';
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
}
