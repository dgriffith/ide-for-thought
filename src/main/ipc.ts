import { ipcMain, type BrowserWindow } from 'electron';
import { Channels } from '../shared/channels';
import * as notebaseFs from './notebase/fs';
import { startWatching, stopWatching } from './notebase/watcher';
import * as gitOps from './git/index';
import * as graph from './graph/index';

let currentRootPath: string | null = null;

export function registerIpcHandlers(win: BrowserWindow): void {
  ipcMain.handle(Channels.NOTEBASE_OPEN, async () => {
    const meta = await notebaseFs.openNotebase();
    if (meta) {
      // Tear down previous notebase
      stopWatching();

      currentRootPath = meta.rootPath;

      // Initialize subsystems for this notebase
      startWatching(meta.rootPath, win);
      await graph.initGraph(meta.rootPath);
      await graph.indexAllNotes(meta.rootPath);
    }
    return meta;
  });

  ipcMain.handle(Channels.NOTEBASE_LIST_FILES, async () => {
    if (!currentRootPath) return [];
    return notebaseFs.listFiles(currentRootPath);
  });

  ipcMain.handle(Channels.NOTEBASE_READ_FILE, async (_e, relativePath: string) => {
    if (!currentRootPath) throw new Error('No notebase open');
    return notebaseFs.readFile(currentRootPath, relativePath);
  });

  ipcMain.handle(Channels.NOTEBASE_WRITE_FILE, async (_e, relativePath: string, content: string) => {
    if (!currentRootPath) throw new Error('No notebase open');
    await notebaseFs.writeFile(currentRootPath, relativePath, content);
    // Re-index the note in the graph
    await graph.indexNote(relativePath, content);
    await graph.persistGraph();
  });

  ipcMain.handle(Channels.NOTEBASE_CREATE_FILE, async (_e, relativePath: string) => {
    if (!currentRootPath) throw new Error('No notebase open');
    await notebaseFs.createFile(currentRootPath, relativePath);
    await graph.indexNote(relativePath, '');
  });

  ipcMain.handle(Channels.NOTEBASE_DELETE_FILE, async (_e, relativePath: string) => {
    if (!currentRootPath) throw new Error('No notebase open');
    await notebaseFs.deleteFile(currentRootPath, relativePath);
  });

  // Git
  ipcMain.handle(Channels.GIT_STATUS, async () => {
    if (!currentRootPath) return { isRepo: false, branch: null, files: [] };
    return gitOps.getStatus(currentRootPath);
  });

  ipcMain.handle(Channels.GIT_COMMIT, async (_e, message: string) => {
    if (!currentRootPath) throw new Error('No notebase open');
    const sha = await gitOps.commitAll(currentRootPath, message);
    return { success: true, sha };
  });

  // Graph
  ipcMain.handle(Channels.GRAPH_QUERY, async (_e, sparql: string) => {
    return graph.queryGraph(sparql);
  });
}
