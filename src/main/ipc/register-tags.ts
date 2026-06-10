import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { rootPathFromEvent } from './helpers';

export function registerTags(): void {
  // Tags
  ipcMain.handle(Channels.TAGS_LIST, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.listTags(projectContext(rootPath));
  });

  ipcMain.handle(Channels.TAGS_NOTES_BY_TAG, (e, tag: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.notesByTag(projectContext(rootPath), tag);
  });

  ipcMain.handle(Channels.TAGS_NOTES_BY_TAG_PREFIX, (e, prefix: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.notesByTagPrefix(projectContext(rootPath), prefix);
  });

  ipcMain.handle(Channels.TAGS_SOURCES_BY_TAG, (e, tag: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.sourcesByTag(projectContext(rootPath), tag);
  });

  ipcMain.handle(Channels.TAGS_ALL_NAMES, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.allTags(projectContext(rootPath));
  });
}
