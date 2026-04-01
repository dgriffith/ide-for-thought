import { ipcMain, shell, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../shared/channels';
import * as notebaseFs from './notebase/fs';
import * as gitOps from './git/index';
import * as graph from './graph/index';
import * as search from './search/index';
import * as savedQueries from './saved-queries';
import { clearRecentProjects } from './recent-projects';
import { rebuildMenu } from './menu';
import { createWindow, openProjectInWindow, closeProjectInWindow, getRootPath, markPathHandled } from './window-manager';

function winFromEvent(e: Electron.IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(e.sender)!;
}

function rootPathFromEvent(e: Electron.IpcMainInvokeEvent): string | null {
  const win = winFromEvent(e);
  return getRootPath(win.id);
}

async function reindexFile(rootPath: string, relativePath: string): Promise<void> {
  if (!relativePath.endsWith('.md')) return;
  const content = await notebaseFs.readFile(rootPath, relativePath);
  await graph.indexNote(relativePath, content);
  search.indexNote(relativePath, content);
}

function removeFromIndexes(relativePath: string): void {
  if (!relativePath.endsWith('.md')) return;
  search.removeNote(relativePath);
  graph.removeNote(relativePath);
}

async function listMdFiles(rootPath: string, relDir: string): Promise<string[]> {
  const results: string[] = [];
  const absDir = path.join(rootPath, relDir);
  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...await listMdFiles(rootPath, rel));
      } else if (entry.name.endsWith('.md')) {
        results.push(rel);
      }
    }
  } catch { /* directory may not exist */ }
  return results;
}

async function persistIndexes(): Promise<void> {
  await Promise.all([search.persist(), graph.persistGraph()]);
}

export function registerIpcHandlers(): void {
  ipcMain.handle(Channels.NOTEBASE_OPEN, async (e) => {
    const meta = await notebaseFs.openNotebase();
    if (meta) {
      const win = winFromEvent(e);
      await openProjectInWindow(win, meta.rootPath);
    }
    return meta;
  });

  ipcMain.handle('notebase:openPath', async (e, rootPath: string) => {
    const win = winFromEvent(e);
    await openProjectInWindow(win, rootPath);
    return { rootPath, name: path.basename(rootPath) };
  });

  ipcMain.handle('notebase:newProject', async (e) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose location for new project',
      buttonLabel: 'Create Project',
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const rootPath = result.filePaths[0];
    const win = winFromEvent(e);
    await openProjectInWindow(win, rootPath);
    return { rootPath, name: path.basename(rootPath) };
  });

  ipcMain.handle('notebase:close', (e) => {
    const win = winFromEvent(e);
    closeProjectInWindow(win.id);
    return null;
  });

  ipcMain.handle('notebase:newWindow', async (_e, rootPath?: string) => {
    const win = createWindow();
    if (rootPath) {
      // Wait for window to be ready before opening project
      win.webContents.once('did-finish-load', async () => {
        await openProjectInWindow(win, rootPath);
        win.webContents.send('project:opened', { rootPath, name: path.basename(rootPath) });
      });
    }
  });

  ipcMain.handle('recent:clear', () => {
    clearRecentProjects();
    rebuildMenu();
  });

  ipcMain.handle(Channels.NOTEBASE_LIST_FILES, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return notebaseFs.listFiles(rootPath);
  });

  ipcMain.handle(Channels.NOTEBASE_READ_FILE, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return notebaseFs.readFile(rootPath, relativePath);
  });

  ipcMain.handle(Channels.NOTEBASE_WRITE_FILE, async (e, relativePath: string, content: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    markPathHandled(relativePath);
    await notebaseFs.writeFile(rootPath, relativePath, content);
    await graph.indexNote(relativePath, content);
    await graph.persistGraph();
    search.indexNote(relativePath, content);
    await search.persist();
  });

  ipcMain.handle(Channels.NOTEBASE_CREATE_FILE, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    markPathHandled(relativePath);
    await notebaseFs.createFile(rootPath, relativePath);
    await graph.indexNote(relativePath, '');
    search.indexNote(relativePath, '');
  });

  ipcMain.handle(Channels.NOTEBASE_DELETE_FILE, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    markPathHandled(relativePath);
    await notebaseFs.deleteFile(rootPath, relativePath);
    removeFromIndexes(relativePath);
    await persistIndexes();
  });

  ipcMain.handle(Channels.NOTEBASE_CREATE_FOLDER, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await notebaseFs.createFolder(rootPath, relativePath);
  });

  ipcMain.handle(Channels.NOTEBASE_DELETE_FOLDER, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const files = await listMdFiles(rootPath, relativePath);
    await notebaseFs.deleteFolder(rootPath, relativePath);
    for (const f of files) removeFromIndexes(f);
    await persistIndexes();
  });

  ipcMain.handle(Channels.NOTEBASE_RENAME, async (e, oldRelPath: string, newRelPath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    markPathHandled(oldRelPath);
    markPathHandled(newRelPath);
    await notebaseFs.rename(rootPath, oldRelPath, newRelPath);
    // Check if directory or file
    const stat = await fs.stat(path.join(rootPath, newRelPath));
    if (stat.isDirectory()) {
      const newFiles = await listMdFiles(rootPath, newRelPath);
      for (const f of newFiles) {
        const oldEquivalent = oldRelPath + f.slice(newRelPath.length);
        removeFromIndexes(oldEquivalent);
        await reindexFile(rootPath, f);
      }
    } else {
      removeFromIndexes(oldRelPath);
      await reindexFile(rootPath, newRelPath);
    }
    await persistIndexes();
  });

  ipcMain.handle(Channels.NOTEBASE_COPY, async (e, srcRelPath: string, destRelPath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await notebaseFs.copyItem(rootPath, srcRelPath, destRelPath);
    const stat = await fs.stat(path.join(rootPath, destRelPath));
    if (stat.isDirectory()) {
      const files = await listMdFiles(rootPath, destRelPath);
      for (const f of files) await reindexFile(rootPath, f);
    } else {
      await reindexFile(rootPath, destRelPath);
    }
    await persistIndexes();
  });

  // Links
  ipcMain.handle(Channels.LINKS_OUTGOING, (_e, relativePath: string) => {
    return graph.outgoingLinks(relativePath);
  });

  ipcMain.handle(Channels.LINKS_BACKLINKS, (_e, relativePath: string) => {
    return graph.backlinks(relativePath);
  });

  // Saved queries
  ipcMain.handle(Channels.QUERIES_LIST, (e) => {
    const rootPath = rootPathFromEvent(e);
    return savedQueries.listSavedQueries(rootPath);
  });

  ipcMain.handle(Channels.QUERIES_SAVE, (e, scope: string, name: string, description: string, query: string) => {
    const rootPath = rootPathFromEvent(e);
    return savedQueries.saveQuery(rootPath, scope as 'project' | 'global', name, description, query);
  });

  ipcMain.handle(Channels.QUERIES_DELETE, (_e, filePath: string) => {
    savedQueries.deleteQuery(filePath);
  });

  // Search
  ipcMain.handle(Channels.SEARCH_QUERY, (_e, query: string) => {
    return search.search(query);
  });

  // Git
  ipcMain.handle(Channels.GIT_STATUS, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { isRepo: false, branch: null, files: [] };
    return gitOps.getStatus(rootPath);
  });

  ipcMain.handle(Channels.GIT_COMMIT, async (e, message: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const sha = await gitOps.commitAll(rootPath, message);
    return { success: true, sha };
  });

  // Graph
  ipcMain.handle(Channels.GRAPH_QUERY, async (_e, sparql: string) => {
    return graph.queryGraph(sparql);
  });

  // Tags
  ipcMain.handle(Channels.TAGS_LIST, () => {
    return graph.listTags();
  });

  ipcMain.handle(Channels.TAGS_NOTES_BY_TAG, (_e, tag: string) => {
    return graph.notesByTag(tag);
  });

  ipcMain.handle(Channels.TAGS_ALL_NAMES, () => {
    return graph.allTags();
  });

  // Export
  ipcMain.handle(Channels.EXPORT_CSV, async (e, csv: string) => {
    const win = winFromEvent(e);
    const result = await dialog.showSaveDialog(win, {
      title: 'Export as CSV',
      defaultPath: 'query-results.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!result.canceled && result.filePath) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(result.filePath, csv, 'utf-8');
    }
  });

  // Shell
  ipcMain.handle(Channels.SHELL_REVEAL_FILE, (e, relativePath?: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    const fullPath = relativePath
      ? path.join(rootPath, relativePath)
      : rootPath;
    shell.showItemInFolder(fullPath);
  });

  // Graph management
  ipcMain.handle(Channels.GRAPH_REBUILD, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { count: 0 };
    const count = await graph.indexAllNotes(rootPath);
    return { count };
  });

  ipcMain.handle(Channels.GRAPH_EXPORT, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    const result = await dialog.showSaveDialog({
      title: 'Export Graph',
      defaultPath: 'graph.ttl',
      filters: [{ name: 'Turtle', extensions: ['ttl'] }],
    });
    if (!result.canceled && result.filePath) {
      await graph.persistGraph();
      const fs = await import('node:fs/promises');
      const srcPath = path.join(rootPath, '.minerva', 'graph.ttl');
      await fs.copyFile(srcPath, result.filePath);
    }
  });
}
