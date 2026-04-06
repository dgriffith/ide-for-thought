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
import { executeTool } from './tools/executor';
import { getSettings, saveSettings } from './llm/settings';
import type { ToolExecutionRequest, LLMSettings } from '../shared/tools/types';
import type { TabSession } from '../shared/types';
import * as approval from './llm/approval';
import * as conversation from './llm/conversation';
import { crystallize } from './llm/crystallize';
import type { ContextBundle, ConversationMessage } from '../shared/types';

function winFromEvent(e: Electron.IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(e.sender)!;
}

function rootPathFromEvent(e: Electron.IpcMainInvokeEvent): string | null {
  const win = winFromEvent(e);
  return getRootPath(win.id);
}

const INDEXABLE_EXTS = new Set(['.md', '.ttl']);

function isIndexable(relativePath: string): boolean {
  return INDEXABLE_EXTS.has(path.extname(relativePath));
}

async function reindexFile(rootPath: string, relativePath: string): Promise<void> {
  if (!isIndexable(relativePath)) return;
  const content = await notebaseFs.readFile(rootPath, relativePath);
  await graph.indexNote(relativePath, content);
  if (relativePath.endsWith('.md')) {
    search.indexNote(relativePath, content);
  }
}

function removeFromIndexes(relativePath: string): void {
  if (!isIndexable(relativePath)) return;
  search.removeNote(relativePath);
  graph.removeNote(relativePath);
}

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
      } else if (INDEXABLE_EXTS.has(path.extname(entry.name))) {
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
      title: 'Choose location for new thoughtbase',
      buttonLabel: 'Create Thoughtbase',
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
    const files = await listIndexableFiles(rootPath, relativePath);
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
      const newFiles = await listIndexableFiles(rootPath, newRelPath);
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
      const files = await listIndexableFiles(rootPath, destRelPath);
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

  ipcMain.handle(Channels.SHELL_OPEN_IN_DEFAULT, (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    shell.openPath(path.join(rootPath, relativePath));
  });

  ipcMain.handle(Channels.SHELL_OPEN_IN_TERMINAL, (e, relativePath?: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    const dir = relativePath
      ? path.join(rootPath, path.dirname(relativePath))
      : rootPath;
    const { exec } = require('child_process');
    if (process.platform === 'darwin') {
      exec(`open -a Terminal "${dir}"`);
    } else if (process.platform === 'win32') {
      exec(`start cmd /K "cd /d ${dir}"`);
    } else {
      exec(`x-terminal-emulator --working-directory="${dir}" || xterm -e "cd '${dir}' && $SHELL"`);
    }
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

  // Tools for Thought
  const activeAbortControllers = new Map<number, AbortController>();

  ipcMain.handle(Channels.TOOL_EXECUTE, async (e, request: ToolExecutionRequest) => {
    const win = winFromEvent(e);
    const controller = new AbortController();
    activeAbortControllers.set(win.id, controller);

    try {
      const result = await executeTool(
        request,
        (chunk: string) => {
          if (!win.isDestroyed()) {
            win.webContents.send(Channels.TOOL_STREAM, chunk);
          }
        },
        controller.signal,
      );
      return result;
    } finally {
      activeAbortControllers.delete(win.id);
    }
  });

  ipcMain.handle(Channels.TOOL_CANCEL, (e) => {
    const win = winFromEvent(e);
    const controller = activeAbortControllers.get(win.id);
    if (controller) {
      controller.abort();
      activeAbortControllers.delete(win.id);
    }
  });

  // Proposals
  ipcMain.handle(Channels.PROPOSAL_LIST, (_e, status?: string) => approval.listProposals(status));
  ipcMain.handle(Channels.PROPOSAL_DETAIL, (_e, uri: string) => approval.getProposal(uri));
  ipcMain.handle(Channels.PROPOSAL_APPROVE, (_e, uri: string) => approval.approveProposal(uri));
  ipcMain.handle(Channels.PROPOSAL_REJECT, (_e, uri: string) => approval.rejectProposal(uri));
  ipcMain.handle(Channels.PROPOSAL_EXPIRE, () => approval.expireProposals());

  // Conversations
  ipcMain.handle(Channels.CONVERSATION_CREATE, (_e, contextBundle: ContextBundle, triggerNodeUri?: string, systemMessage?: string) =>
    conversation.create(contextBundle, triggerNodeUri, systemMessage));
  ipcMain.handle(Channels.CONVERSATION_APPEND, (_e, id: string, role: ConversationMessage['role'], content: string) =>
    conversation.appendMessage(id, role, content));
  ipcMain.handle(Channels.CONVERSATION_RESOLVE, (_e, id: string) => conversation.resolve(id));
  ipcMain.handle(Channels.CONVERSATION_ABANDON, (_e, id: string) => conversation.abandon(id));
  ipcMain.handle(Channels.CONVERSATION_LOAD, (_e, id: string) => conversation.load(id));
  ipcMain.handle(Channels.CONVERSATION_LIST, () => conversation.listAll());
  ipcMain.handle(Channels.CONVERSATION_LIST_ACTIVE, () => conversation.listActive());

  // Conversation send + LLM streaming
  const convAbortControllers = new Map<number, AbortController>();

  ipcMain.handle(Channels.CONVERSATION_SEND, async (e, convId: string, userMessage: string, systemPrompt?: string) => {
    const win = winFromEvent(e);
    const controller = new AbortController();
    convAbortControllers.set(win.id, controller);

    try {
      // Append user message
      const conv = await conversation.appendMessage(convId, 'user', userMessage);

      // Build message history for the LLM
      const { complete: llmComplete } = await import('./llm/index');
      const messages = conv.messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const output = await llmComplete('', {
        system: systemPrompt,
        messages,
        callbacks: {
          onChunk: (chunk: string) => {
            if (!win.isDestroyed()) {
              win.webContents.send(Channels.CONVERSATION_STREAM, chunk);
            }
          },
          signal: controller.signal,
        },
      });

      // Append assistant response
      const updated = await conversation.appendMessage(convId, 'assistant', output);
      return updated;
    } finally {
      convAbortControllers.delete(win.id);
    }
  });

  ipcMain.handle(Channels.CONVERSATION_CANCEL, (e) => {
    const win = winFromEvent(e);
    const controller = convAbortControllers.get(win.id);
    if (controller) {
      controller.abort();
      convAbortControllers.delete(win.id);
    }
  });

  ipcMain.handle(Channels.CONVERSATION_CRYSTALLIZE, async (_e, text: string, conversationId: string) => {
    const convUri = `https://minerva.dev/ontology/thought#conversation/${conversationId}`;
    return crystallize(text, convUri);
  });

  ipcMain.handle(Channels.TOOL_GET_SETTINGS, () => getSettings());

  ipcMain.handle(Channels.TOOL_SET_SETTINGS, (_e, settings: LLMSettings) => saveSettings(settings));

  // Bookmarks
  ipcMain.handle(Channels.BOOKMARKS_LOAD, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    try {
      const bmPath = path.join(rootPath, '.minerva', 'bookmarks.json');
      const data = await fs.readFile(bmPath, 'utf-8');
      return JSON.parse(data);
    } catch { return []; }
  });

  ipcMain.handle(Channels.BOOKMARKS_SAVE, async (e, tree: unknown) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    const bmPath = path.join(rootPath, '.minerva', 'bookmarks.json');
    await fs.mkdir(path.dirname(bmPath), { recursive: true });
    await fs.writeFile(bmPath, JSON.stringify(tree, null, 2), 'utf-8');
  });

  // Tab session persistence
  ipcMain.handle(Channels.TABS_SAVE, async (e, session: TabSession) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    const tabsPath = path.join(rootPath, '.minerva', 'tabs.json');
    await fs.mkdir(path.dirname(tabsPath), { recursive: true });
    await fs.writeFile(tabsPath, JSON.stringify(session, null, 2), 'utf-8');
  });

  ipcMain.handle(Channels.TABS_LOAD, async (e): Promise<TabSession | null> => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return null;
    try {
      const tabsPath = path.join(rootPath, '.minerva', 'tabs.json');
      const data = await fs.readFile(tabsPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  });
}
