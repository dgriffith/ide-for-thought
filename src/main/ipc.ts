import { ipcMain, type BrowserWindow } from 'electron';
import { Channels } from '../shared/channels';
import * as notebaseFs from './notebase/fs';

let currentRootPath: string | null = null;

export function registerIpcHandlers(_win: BrowserWindow): void {
  ipcMain.handle(Channels.NOTEBASE_OPEN, async () => {
    const meta = await notebaseFs.openNotebase();
    if (meta) {
      currentRootPath = meta.rootPath;
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
    return notebaseFs.writeFile(currentRootPath, relativePath, content);
  });

  ipcMain.handle(Channels.NOTEBASE_CREATE_FILE, async (_e, relativePath: string) => {
    if (!currentRootPath) throw new Error('No notebase open');
    return notebaseFs.createFile(currentRootPath, relativePath);
  });

  ipcMain.handle(Channels.NOTEBASE_DELETE_FILE, async (_e, relativePath: string) => {
    if (!currentRootPath) throw new Error('No notebase open');
    return notebaseFs.deleteFile(currentRootPath, relativePath);
  });

  // Stubs
  ipcMain.handle(Channels.GIT_STATUS, async () => ({ files: [] }));
  ipcMain.handle(Channels.GIT_COMMIT, async () => ({ success: false, message: 'Not implemented' }));
  ipcMain.handle(Channels.GRAPH_QUERY, async () => ({ results: [] }));
}
