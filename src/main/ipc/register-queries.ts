import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import { projectContext } from '../project-context-types';
import * as search from '../search/index';
import * as savedQueries from '../saved-queries';
import { rebuildMenu } from '../menu';
import { rootPathFromEvent } from './helpers';

export function registerQueries(): void {
  // Saved queries
  ipcMain.handle(Channels.QUERIES_LIST, (e) => {
    const rootPath = rootPathFromEvent(e);
    return savedQueries.listSavedQueries(rootPath);
  });

  ipcMain.handle(Channels.QUERIES_SAVE, (e, scope: string, name: string, description: string, query: string, language: string, group: string | null = null) => {
    const rootPath = rootPathFromEvent(e);
    const result = savedQueries.saveQuery(
      rootPath,
      scope as 'project' | 'global',
      name,
      description,
      query,
      language === 'sql' ? 'sql' : 'sparql',
      group,
    );
    rebuildMenu();
    return result;
  });

  ipcMain.handle(Channels.QUERIES_DELETE, (_e, filePath: string) => {
    savedQueries.deleteQuery(filePath);
    rebuildMenu();
  });

  ipcMain.handle(Channels.QUERIES_RENAME, (_e, filePath: string, newName: string) => {
    const newPath = savedQueries.renameQuery(filePath, newName);
    rebuildMenu();
    return newPath;
  });

  ipcMain.handle(Channels.QUERIES_MOVE, (e, filePath: string, newScope: string) => {
    const rootPath = rootPathFromEvent(e);
    const newPath = savedQueries.moveQueryScope(filePath, newScope as 'project' | 'global', rootPath);
    rebuildMenu();
    return newPath;
  });

  ipcMain.handle(Channels.QUERIES_SET_GROUP, (_e, filePath: string, group: string | null) => {
    savedQueries.setQueryGroup(filePath, group);
    rebuildMenu();
  });

  ipcMain.handle(Channels.QUERIES_SET_ORDER, (_e, entries: Array<{ filePath: string; order: number | null }>) => {
    savedQueries.setQueryOrder(entries);
    rebuildMenu();
  });

  // Search
  ipcMain.handle(Channels.SEARCH_QUERY, (e, query: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return search.search(projectContext(rootPath), query);
  });
}
