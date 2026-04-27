import { ipcMain, shell, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Channels } from '../shared/channels';
import * as notebaseFs from './notebase/fs';
import { isIndexable } from './notebase/indexable-files';
import { renameWithLinkRewrites } from './notebase/rename';
import { renameAnchor } from './notebase/rename-anchor';
import { renameSource, renameExcerpt } from './notebase/rename-source-excerpt';
import * as gitOps from './git/index';
import * as graph from './graph/index';
import { projectContext } from './project-context-types';
import { writeAndReindex } from './notebase/write-pipeline';
import type { WritePipelineHooks } from './notebase/write-pipeline';
import * as search from './search/index';
import * as savedQueries from './saved-queries';
import { clearRecentProjects } from './recent-projects';
import { rebuildMenu } from './menu';
import { createWindow, openProjectInWindow, closeProjectInWindow, getRootPath, markPathHandled, windowsForProject } from './window-manager';
import { executeTool, prepareConversationTool } from './tools/executor';
import { runAutoTag } from './llm/auto-tag';
import {
  suggestLinksTo,
  applyAutoLinkToSuggestions,
  suggestLinksInbound,
  applyInboundSuggestions,
} from './llm/auto-link';
import { suggestDecomposition, type DecomposeHints } from './llm/decompose';
import { decomposeClaims, type DecomposeClaimsArgs } from './llm/decompose-claims';
import { findArguments, type FindArgumentsArgs } from './llm/find-arguments';
import {
  formatNoteContent,
  formatFile as formatFileOnDisk,
  formatFolder as formatFolderOnDisk,
} from './formatter/orchestrator';
import { ingestUrl } from './sources/ingest';
import * as tables from './sources/tables';
import { ingestIdentifier } from './sources/ingest-identifier';
import { ingestPdf, finishPdfOcrIngest, readOriginalPdf } from './sources/ingest-pdf';
import { deleteSource } from './sources/delete-source';
import { importBibtex } from './sources/import-bibtex';
import { importZoteroRdf } from './sources/import-zotero-rdf';
import { dropImport } from './notebase/drop-import';
import { searchInNotes, replaceInNotes, type SearchOptions, type ReplaceSelection } from './notebase/search-in-notes';
import { runCell as runComputeCell, registeredLanguages as computeLanguages } from './compute/registry';
import { restartKernel as restartPythonKernel } from './compute/python-kernel';
import { saveCellOutput, type SaveCellOutputInput } from './compute/save-cell-output';
import * as publish from './publish';
import { createExcerpt } from './sources/create-excerpt';
import type { FormatSettings } from '../shared/formatter/engine';
import type { AutoLinkSuggestion } from '../shared/refactor/auto-link';
import type { AutoLinkInboundSuggestion } from '../shared/refactor/auto-link-inbound';
import * as healthChecks from './graph/health-checks';
import { getToolBySlashCommand } from '../shared/tools/registry';
import '../shared/tools/definitions/index';
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

const DEFAULT_CONVERSATION_SYSTEM_PROMPT = [
  'You are an assistant embedded in Minerva, a markdown-based thinking tool.',
  'The user is working inside a thoughtbase: a collection of interlinked notes backed by an RDF knowledge graph.',
  '',
  'You have six tools. Prefer the thoughtbase tools for anything inside the user\'s notes; use the web tools for facts, events, documentation, or sources outside the thoughtbase.',
  '',
  'Thoughtbase tools:',
  '- search_notes: full-text search across the thoughtbase.',
  '- read_note: read a specific note by its relative path.',
  '- query_graph: run a SPARQL query against the knowledge graph (minerva/thought prefixes are auto-injected).',
  '- describe_graph_schema: fetch the full ontology TTL. Call this before writing a non-trivial SPARQL query if you are unsure about class or predicate names.',
  '',
  'Web tools:',
  '- web_search: search the web for current information, news, documentation, or external references.',
  '- web_fetch: fetch the contents of a specific URL — use this after web_search to read a promising result in full, or when the user gives you a URL directly.',
  '',
  'Usage guidance:',
  '- For questions about the user\'s notes or ideas they\'ve captured, use search_notes and read_note.',
  '- For structural questions (what links to what, which notes share a tag, which claims cite a source), use query_graph; fall back to describe_graph_schema if a query fails or you are guessing at predicates.',
  '- For current events, external facts, recent research, or things outside the thoughtbase, use web_search.',
  '- It\'s often useful to combine tools: search_notes to see what the user already has, then web_search to fill in what they don\'t. Cite your web sources.',
  '',
  'You cannot modify the graph or create notes. If the user asks you to change something, describe the change clearly so they can apply it — or note that an approval-gated proposal tool will be added later.',
  '',
  'Answer in GitHub-flavored markdown. When you reference a note, cite its relative path so the user can open it.',
].join('\n');

function buildConversationSystemPrompt(
  userSystem: string | undefined,
  contextBundle: ContextBundle,
): string {
  const parts = [DEFAULT_CONVERSATION_SYSTEM_PROMPT];
  if (contextBundle.notePath) {
    parts.push('', `The user started this conversation from the note: ${contextBundle.notePath}`);
  }
  if (userSystem && userSystem.trim()) {
    parts.push('', userSystem.trim());
  }
  return parts.join('\n');
}

function rootPathFromEvent(e: Electron.IpcMainInvokeEvent): string | null {
  const win = winFromEvent(e);
  return getRootPath(win.id);
}

async function reindexFile(rootPath: string, relativePath: string): Promise<void> {
  if (!isIndexable(relativePath)) return;
  const content = await notebaseFs.readFile(rootPath, relativePath);
  const ctx = projectContext(rootPath);
  await graph.indexNote(ctx, relativePath, content);
  if (relativePath.endsWith('.md')) {
    search.indexNote(ctx, relativePath, content);
  }
}

function removeFromIndexes(rootPath: string, relativePath: string): void {
  if (!isIndexable(relativePath)) return;
  const ctx = projectContext(rootPath);
  search.removeNote(ctx, relativePath);
  graph.removeNote(ctx, relativePath);
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
      } else if (isIndexable(entry.name)) {
        results.push(rel);
      }
    }
  } catch { /* directory may not exist */ }
  return results;
}

async function persistIndexes(rootPath: string): Promise<void> {
  const ctx = projectContext(rootPath);
  // graph.ttl is a cold snapshot (#348). Persist only the search
  // index here; the graph flushes on project release / app-quit.
  void ctx;
  await search.persist(ctx);
}

function broadcastRewritten(rootPath: string, paths: string[]): void {
  if (paths.length === 0) return;
  for (const targetWin of windowsForProject(rootPath)) {
    targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, paths);
  }
}

function broadcastHeadingRename(rootPath: string, candidate: graph.HeadingRenameCandidate): void {
  for (const targetWin of windowsForProject(rootPath)) {
    targetWin.webContents.send(Channels.NOTEBASE_HEADING_RENAME_SUGGESTED, candidate);
  }
}

const hooks: WritePipelineHooks = {
  markPathHandled,
  broadcastRewritten,
  broadcastHeadingRename,
};

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

  ipcMain.handle('notebase:newWindow', (_e, rootPath?: string) => {
    const win = createWindow();
    if (rootPath) {
      // Wait for window to be ready before opening project
      win.webContents.once('did-finish-load', async () => {
        await openProjectInWindow(win, rootPath);
        win.webContents.send('project:opened', { rootPath, name: path.basename(rootPath) });
      });
    }
  });

  // ── "…in new window" variants ─────────────────────────────────────────────
  // Renderer decides whether the user picked "this window" (existing IPCs) or
  // "new window" (these). The picker runs in main so we can parent it to the
  // invoking window for focus; the fresh window is created once the user
  // commits to a path.

  ipcMain.handle('notebase:openInNewWindow', async (e) => {
    const parentWin = winFromEvent(e);
    const result = await dialog.showOpenDialog(parentWin, {
      properties: ['openDirectory'],
      title: 'Open thoughtbase',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const rootPath = result.filePaths[0];
    const freshWin = createWindow();
    freshWin.webContents.once('did-finish-load', async () => {
      await openProjectInWindow(freshWin, rootPath);
      freshWin.webContents.send('project:opened', { rootPath, name: path.basename(rootPath) });
    });
    return { rootPath, name: path.basename(rootPath) };
  });

  ipcMain.handle('notebase:newProjectInNewWindow', async (e) => {
    const parentWin = winFromEvent(e);
    const result = await dialog.showOpenDialog(parentWin, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose location for new thoughtbase',
      buttonLabel: 'Create Thoughtbase',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const rootPath = result.filePaths[0];
    const freshWin = createWindow();
    freshWin.webContents.once('did-finish-load', async () => {
      await openProjectInWindow(freshWin, rootPath);
      freshWin.webContents.send('project:opened', { rootPath, name: path.basename(rootPath) });
    });
    return { rootPath, name: path.basename(rootPath) };
  });

  ipcMain.handle('notebase:openPathInNewWindow', (_e, rootPath: string) => {
    const freshWin = createWindow();
    freshWin.webContents.once('did-finish-load', async () => {
      await openProjectInWindow(freshWin, rootPath);
      freshWin.webContents.send('project:opened', { rootPath, name: path.basename(rootPath) });
    });
    return { rootPath, name: path.basename(rootPath) };
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
    // Renderer-initiated save — it already has the content, so suppress
    // the rewritten broadcast (no need to tell the renderer it just wrote).
    await writeAndReindex(rootPath, relativePath, content, hooks, {
      suppressRewrittenBroadcast: true,
    });
  });

  ipcMain.handle(Channels.NOTEBASE_CREATE_FILE, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    markPathHandled(relativePath);
    await notebaseFs.createFile(rootPath, relativePath);
    const ctx = projectContext(rootPath);
    await graph.indexNote(ctx, relativePath, '');
    search.indexNote(ctx, relativePath, '');
  });

  ipcMain.handle(Channels.NOTEBASE_DELETE_FILE, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    markPathHandled(relativePath);
    await notebaseFs.deleteFile(rootPath, relativePath);
    removeFromIndexes(rootPath, relativePath);
    await persistIndexes(rootPath);
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
    for (const f of files) removeFromIndexes(rootPath, f);
    await persistIndexes(rootPath);
  });

  ipcMain.handle(Channels.NOTEBASE_RENAME, async (e, oldRelPath: string, newRelPath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');

    const ctx = projectContext(rootPath);
    const { transitions, rewrittenPaths } = await renameWithLinkRewrites(rootPath, oldRelPath, newRelPath, {
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith('.md')) search.indexNote(ctx, relPath, content);
      },
      removeHook: (relPath) => search.removeNote(ctx, relPath),
    });

    // Broadcast to every window showing this project so their editor tabs
    // refresh paths and content instead of silently overwriting on next save.
    for (const targetWin of windowsForProject(rootPath)) {
      if (transitions.length > 0) {
        targetWin.webContents.send(Channels.NOTEBASE_RENAMED, transitions);
      }
      if (rewrittenPaths.length > 0) {
        targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, rewrittenPaths);
      }
    }

    await persistIndexes(rootPath);
  });

  ipcMain.handle(Channels.NOTEBASE_RENAME_SOURCE, async (e, oldId: string, newId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const ctx = projectContext(rootPath);
    const { rewrittenPaths } = await renameSource(rootPath, oldId, newId, {
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith('.md')) search.indexNote(ctx, relPath, content);
      },
    });
    broadcastRewritten(rootPath, rewrittenPaths);
    await persistIndexes(rootPath);
    return { rewrittenPaths };
  });

  ipcMain.handle(Channels.NOTEBASE_RENAME_EXCERPT, async (e, oldId: string, newId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const ctx = projectContext(rootPath);
    const { rewrittenPaths } = await renameExcerpt(rootPath, oldId, newId, {
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith('.md')) search.indexNote(ctx, relPath, content);
      },
    });
    broadcastRewritten(rootPath, rewrittenPaths);
    await persistIndexes(rootPath);
    return { rewrittenPaths };
  });

  ipcMain.handle(
    Channels.NOTEBASE_RENAME_ANCHOR,
    async (e, targetRelativePath: string, oldSlug: string, newSlug: string) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');

      const ctx = projectContext(rootPath);
      const { rewrittenPaths } = await renameAnchor(rootPath, targetRelativePath, oldSlug, newSlug, {
        markPathHandled,
        reindexHook: (relPath, content) => {
          if (relPath.endsWith('.md')) search.indexNote(ctx, relPath, content);
        },
      });

      // Same tab-refresh pipeline as #145 — open editors for rewritten notes
      // refresh in place so the next auto-save doesn't undo the anchor rewrite.
      if (rewrittenPaths.length > 0) {
        for (const targetWin of windowsForProject(rootPath)) {
          targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, rewrittenPaths);
        }
      }

      await persistIndexes(rootPath);
      return { rewrittenPaths };
    },
  );

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
    await persistIndexes(rootPath);
  });

  ipcMain.handle(Channels.NOTEBASE_SEARCH_IN_NOTES, async (e, opts: SearchOptions) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return searchInNotes(rootPath, opts);
  });

  ipcMain.handle(Channels.NOTEBASE_REPLACE_IN_NOTES, async (e, opts: SearchOptions & { replacement: string; selections: ReplaceSelection[] }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { changedPaths: [], replacedCount: 0 };
    const result = await replaceInNotes(rootPath, opts);
    if (result.changedPaths.length > 0) {
      // Re-index each rewritten file so the graph + search index stay in
      // sync, then tell open editor tabs to reload from disk.
      for (const rel of result.changedPaths) await reindexFile(rootPath, rel);
      await persistIndexes(rootPath);
      broadcastRewritten(rootPath, result.changedPaths);
    }
    return result;
  });

  // Links
  ipcMain.handle(Channels.LINKS_OUTGOING, (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.outgoingLinks(projectContext(rootPath), relativePath);
  });

  ipcMain.handle(Channels.LINKS_BACKLINKS, (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.backlinks(projectContext(rootPath), relativePath);
  });

  // Coalesced bundle for the right-sidebar link panels (#351). Replaces
  // the parallel LINKS_OUTGOING + LINKS_BACKLINKS round-trips on every
  // tab switch — one IPC, one graph-state pass, both directions together.
  ipcMain.handle(Channels.LINKS_BUNDLE, (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { outgoing: [], backlinks: [] };
    const ctx = projectContext(rootPath);
    return {
      outgoing: graph.outgoingLinks(ctx, relativePath),
      backlinks: graph.backlinks(ctx, relativePath),
    };
  });

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
  ipcMain.handle(Channels.GRAPH_QUERY, async (e, sparql: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return graph.queryGraph(projectContext(rootPath), sparql);
  });

  // Tables (DuckDB)
  ipcMain.handle(Channels.TABLES_QUERY, async (e, sql: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { ok: false, error: 'No project open' };
    return tables.runQuery(projectContext(rootPath), sql);
  });

  ipcMain.handle(Channels.TABLES_LIST, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return tables.listTables(projectContext(rootPath));
  });

  ipcMain.handle(Channels.GRAPH_SCHEMA_FOR_COMPLETION, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return null;
    return graph.schemaForCompletion(projectContext(rootPath));
  });

  ipcMain.handle(Channels.GRAPH_SOURCE_DETAIL, (e, sourceId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return null;
    return graph.getSourceDetail(projectContext(rootPath), sourceId);
  });

  ipcMain.handle(Channels.GRAPH_EXCERPT_SOURCE, (e, excerptId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return null;
    return graph.getExcerptSource(projectContext(rootPath), excerptId);
  });

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
    void shell.openPath(path.join(rootPath, relativePath));
  });

  ipcMain.handle(Channels.SHELL_OPEN_IN_TERMINAL, (e, relativePath?: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    const dir = relativePath
      ? path.join(rootPath, path.dirname(relativePath))
      : rootPath;
    // Use spawn with explicit args (no shell) so a filename containing
    // shell metacharacters can't inject. Detached + unref so closing the
    // app doesn't kill the user's terminal session.
    const detached = { stdio: 'ignore' as const, detached: true };
    if (process.platform === 'darwin') {
      spawn('open', ['-a', 'Terminal', dir], detached).unref();
    } else if (process.platform === 'win32') {
      // `start` is a cmd.exe builtin; the empty title arg is start's
      // documented quirk for paths-with-spaces. /D sets the new
      // window's starting directory — no string interpolation needed.
      spawn('cmd.exe', ['/c', 'start', '', '/D', dir, 'cmd.exe', '/K'], detached).unref();
    } else {
      // Try the Debian-style chooser first, fall back to xterm on
      // spawn-error (binary missing). Both get the directory through
      // explicit args / cwd, never the shell.
      const child = spawn('x-terminal-emulator', [`--working-directory=${dir}`], detached);
      child.once('error', () => {
        const shellPath = process.env.SHELL ?? '/bin/sh';
        spawn('xterm', ['-e', shellPath], { ...detached, cwd: dir }).unref();
      });
      child.unref();
    }
  });

  ipcMain.handle(Channels.SHELL_OPEN_EXTERNAL, async (_e, url: string) => {
    // Only http(s) — don't let anyone (or the LLM) coerce us into opening
    // file://, javascript:, etc.
    if (typeof url !== 'string') return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    await shell.openExternal(parsed.toString());
  });

  // Inspections
  ipcMain.handle(Channels.INSPECTIONS_LIST, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return healthChecks.getInspections(projectContext(rootPath));
  });
  ipcMain.handle(Channels.INSPECTIONS_RUN, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return healthChecks.runAllChecks(projectContext(rootPath));
  });

  // Grounding check — fuzzy match a claim against graph labels
  ipcMain.handle(Channels.GRAPH_GROUND_CHECK, async (e, claimText: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    const escaped = claimText.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const results = await graph.queryGraph(projectContext(rootPath), `
      PREFIX dc: <http://purl.org/dc/terms/>
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      PREFIX minerva: <https://minerva.dev/ontology#>
      SELECT ?node ?label ?type WHERE {
        { ?node dc:title ?label . ?node a minerva:Note . BIND("note" AS ?type) }
        UNION
        { ?node thought:label ?label . ?node a ?cls . ?cls rdfs:subClassOf thought:Component . BIND("component" AS ?type) }
        FILTER(CONTAINS(LCASE(?label), LCASE("${escaped}")))
      } LIMIT 5
    `);
    return results.results;
  });

  // Graph management
  ipcMain.handle(Channels.GRAPH_EXPORT, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    const result = await dialog.showSaveDialog({
      title: 'Export Graph',
      defaultPath: 'graph.ttl',
      filters: [{ name: 'Turtle', extensions: ['ttl'] }],
    });
    if (!result.canceled && result.filePath) {
      await graph.persistGraph(projectContext(rootPath));
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

  ipcMain.handle(Channels.TOOL_PREPARE_CONVERSATION, (_e, request: ToolExecutionRequest) =>
    prepareConversationTool(request));

  ipcMain.handle(Channels.REFACTOR_AUTO_TAG, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');

    const plan = await runAutoTag(rootPath, relativePath);
    if (!plan.content) return { added: [] };

    // Route through the canonical 6-step write pipeline so heading-rename
    // detection fires uniformly with direct edits (#341 — this site
    // historically open-coded a 5-step variant that skipped step 6).
    await writeAndReindex(rootPath, relativePath, plan.content, hooks);
    return { added: plan.added };
  });

  ipcMain.handle(Channels.REFACTOR_AUTO_LINK_SUGGEST, async (e, activeRelPath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return suggestLinksTo(rootPath, activeRelPath);
  });

  ipcMain.handle(
    Channels.REFACTOR_AUTO_LINK_APPLY,
    async (e, activeRelPath: string, accepted: AutoLinkSuggestion[]) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');

      const { content, applied, skipped } = await applyAutoLinkToSuggestions(
        rootPath,
        activeRelPath,
        accepted,
      );
      if (applied.length === 0) return { applied, skipped };

      // 6-step pipeline (#341).
      await writeAndReindex(rootPath, activeRelPath, content, hooks);
      return { applied, skipped };
    },
  );

  ipcMain.handle(Channels.REFACTOR_AUTO_LINK_INBOUND_SUGGEST, async (e, activeRelPath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return suggestLinksInbound(rootPath, activeRelPath);
  });

  ipcMain.handle(
    Channels.REFACTOR_DECOMPOSE_SUGGEST,
    async (e, activeRelPath: string, hints?: DecomposeHints) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      return suggestDecomposition(rootPath, activeRelPath, hints ?? {});
    },
  );

  ipcMain.handle(
    Channels.RESEARCH_DECOMPOSE_CLAIMS,
    async (e, args: DecomposeClaimsArgs) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      return decomposeClaims(projectContext(rootPath), args);
    },
  );

  ipcMain.handle(
    Channels.RESEARCH_FIND_ARGUMENTS,
    async (e, args: FindArgumentsArgs) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      return findArguments(projectContext(rootPath), args);
    },
  );

  // Formatter (issue #153)
  ipcMain.handle(
    Channels.FORMATTER_FORMAT_CONTENT,
    (_e, content: string, settings: FormatSettings, relativePath?: string) =>
      formatNoteContent(content, settings, relativePath),
  );

  // Project-scoped formatter settings (#154). Stored in .minerva/formatter.json
  // so rule choices travel with the thoughtbase in git.
  ipcMain.handle(Channels.FORMATTER_LOAD_SETTINGS, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { enabled: {}, configs: {} };
    try {
      const p = path.join(rootPath, '.minerva', 'formatter.json');
      const data = await fs.readFile(p, 'utf-8');
      const parsed = JSON.parse(data) as { enabled?: Record<string, boolean>; configs?: Record<string, unknown> };
      return {
        enabled: (parsed?.enabled && typeof parsed.enabled === 'object') ? parsed.enabled : {},
        configs: (parsed?.configs && typeof parsed.configs === 'object') ? parsed.configs : {},
      };
    } catch { return { enabled: {}, configs: {} }; }
  });

  ipcMain.handle(Channels.FORMATTER_SAVE_SETTINGS, async (e, settings: FormatSettings) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    const p = path.join(rootPath, '.minerva', 'formatter.json');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(settings, null, 2), 'utf-8');
  });

  ipcMain.handle(Channels.SOURCES_INGEST_URL, async (e, url: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return await ingestUrl(rootPath, url);
  });

  ipcMain.handle(Channels.SOURCES_INGEST_IDENTIFIER, async (e, identifier: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return await ingestIdentifier(rootPath, identifier);
  });

  ipcMain.handle(Channels.FILES_DROP_IMPORT, async (e, targetFolder: string, localPaths: string[]) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return await dropImport(rootPath, targetFolder ?? '', localPaths ?? []);
  });

  ipcMain.handle(Channels.COMPUTE_RUN_CELL, async (e, language: string, code: string, notePath?: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return await runComputeCell(language, code, { rootPath, notePath });
  });

  ipcMain.handle(Channels.COMPUTE_LANGUAGES, () => computeLanguages());

  ipcMain.handle(Channels.COMPUTE_RESTART_PYTHON_KERNEL, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    await restartPythonKernel(rootPath);
  });

  ipcMain.handle(Channels.COMPUTE_SAVE_CELL_OUTPUT, async (e, input: SaveCellOutputInput) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return await saveCellOutput(rootPath, input);
  });

  // ── Publication (#282) ─────────────────────────────────────────────────────

  ipcMain.handle(Channels.PUBLISH_LIST_EXPORTERS, () =>
    publish.listExporters().map((e) => ({
      id: e.id,
      label: e.label,
      // Default to the non-tree kinds when the exporter didn't declare —
      // tree is opt-in (only exporters that know how to walk wiki-link
      // closures should expose it as a scope in the dialog).
      acceptedKinds: e.acceptedKinds ?? ['single-note', 'folder', 'project'],
    })),
  );

  ipcMain.handle(Channels.PUBLISH_RESOLVE_PLAN, async (e, input: publish.ExportInput, opts?: {
    exporterId?: string;
    linkPolicy?: publish.LinkPolicy;
  }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const plan = await publish.resolvePlan(rootPath, input, { linkPolicy: opts?.linkPolicy });
    // Strip `content` + `frontmatter` from the wire payload — the preview
    // only needs to audit paths, kinds, and exclusion reasons; loading
    // every file's text over IPC is wasteful.
    const exporter = opts?.exporterId ? publish.getExporter(opts.exporterId) : null;
    return {
      exporterId: exporter?.id ?? '',
      exporterLabel: exporter?.label ?? '',
      inputs: plan.inputs.map((f) => ({
        relativePath: f.relativePath,
        kind: f.kind,
        title: f.title,
      })),
      excluded: plan.excluded,
    };
  });

  ipcMain.handle(Channels.PUBLISH_RUN_EXPORT, async (e, args: Omit<publish.RunExportInput, 'outputDir'> & { outputDir?: string }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    let outputDir = args.outputDir;
    // When the renderer doesn't pass an outputDir, open a directory
    // picker here. Parents the dialog to the invoking window so it
    // behaves as a modal rather than a floating sheet.
    if (!outputDir) {
      const win = winFromEvent(e);
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose export destination',
        buttonLabel: 'Export here',
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      outputDir = result.filePaths[0];
    }
    return await publish.runExport(rootPath, { ...args, outputDir });
  });

  ipcMain.handle(Channels.SOURCES_IMPORT_BIBTEX, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const win = winFromEvent(e);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'BibTeX', extensions: ['bib', 'bibtex'] }],
      title: 'Import BibTeX',
      buttonLabel: 'Import',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return await importBibtex(rootPath, result.filePaths[0], {
      onProgress: (progress) => {
        if (!win.isDestroyed()) {
          win.webContents.send(Channels.SOURCES_IMPORT_BIBTEX_PROGRESS, progress);
        }
      },
    });
  });

  ipcMain.handle(Channels.SOURCES_IMPORT_ZOTERO_RDF, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const win = winFromEvent(e);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Zotero RDF', extensions: ['rdf', 'xml'] }],
      title: 'Import Zotero RDF',
      buttonLabel: 'Import',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return await importZoteroRdf(rootPath, result.filePaths[0], {
      onProgress: (progress) => {
        if (!win.isDestroyed()) {
          win.webContents.send(Channels.SOURCES_IMPORT_ZOTERO_RDF_PROGRESS, progress);
        }
      },
    });
  });

  ipcMain.handle(Channels.SOURCES_INGEST_PDF, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const win = winFromEvent(e);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      title: 'Ingest PDF',
      buttonLabel: 'Ingest',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const ingested = await ingestPdf(rootPath, result.filePaths[0]);
    // Re-index the new source so it shows up in the sidebar + graph.
    await reindexFile(rootPath, `.minerva/sources/${ingested.sourceId}/meta.ttl`);
    await persistIndexes(rootPath);
    return ingested;
  });

  // Read the raw PDF bytes of a previously-persisted source, for the
  // renderer-side OCR worker (#95).
  ipcMain.handle(Channels.SOURCES_READ_PDF, async (e, sourceId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return await readOriginalPdf(rootPath, sourceId);
  });

  // Finalise a scanned-PDF ingest: the renderer has run OCR and hands
  // back the per-page text. We rewrite body.md + stamp meta.ttl with
  // extractionMethod "ocr" (#95).
  ipcMain.handle(Channels.SOURCES_FINISH_PDF_OCR, async (e, sourceId: string, pages: string[]) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await finishPdfOcrIngest(rootPath, sourceId, pages);
    await reindexFile(rootPath, `.minerva/sources/${sourceId}/meta.ttl`);
    await persistIndexes(rootPath);
    const win = winFromEvent(e);
    if (!win.isDestroyed()) win.webContents.send(Channels.SOURCES_CHANGED);
  });

  ipcMain.handle(Channels.SOURCES_LIST_ALL, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.listAllSources(projectContext(rootPath));
  });

  ipcMain.handle(Channels.SOURCES_DELETE, async (e, sourceId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const result = await deleteSource(rootPath, sourceId);
    await persistIndexes(rootPath);
    const win = winFromEvent(e);
    if (!win.isDestroyed()) {
      win.webContents.send(Channels.SOURCES_CHANGED);
      win.webContents.send(Channels.EXCERPTS_CHANGED);
    }
    return result;
  });

  ipcMain.handle(Channels.SOURCES_CREATE_EXCERPT, async (e, params: {
    sourceId: string;
    citedText: string;
    page?: number | null;
    pageRange?: string | null;
    locationText?: string | null;
  }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return await createExcerpt(rootPath, params);
  });

  ipcMain.handle(
    Channels.FORMATTER_FORMAT_FILE,
    async (e, relativePath: string, settings: FormatSettings) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      const result = await formatFileOnDisk(rootPath, relativePath, settings);
      const touched = result.changed
        ? [relativePath, ...result.cascadedPaths]
        : result.cascadedPaths;
      if (touched.length > 0) {
        for (const p of touched) markPathHandled(p);
        await persistIndexes(rootPath);
        broadcastRewritten(rootPath, touched);
      }
      return result;
    },
  );

  ipcMain.handle(
    Channels.FORMATTER_FORMAT_FOLDER,
    async (e, relDir: string, settings: FormatSettings) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      const summary = await formatFolderOnDisk(rootPath, relDir ?? '', settings);
      const touched = [...summary.changedPaths, ...summary.cascadedPaths];
      if (touched.length > 0) {
        for (const p of touched) markPathHandled(p);
        await persistIndexes(rootPath);
        broadcastRewritten(rootPath, touched);
      }
      return summary;
    },
  );

  ipcMain.handle(
    Channels.REFACTOR_AUTO_LINK_INBOUND_APPLY,
    async (e, activeRelPath: string, accepted: AutoLinkInboundSuggestion[]) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');

      const { applied, skipped, touchedPaths, updatedContents } = await applyInboundSuggestions(
        rootPath,
        activeRelPath,
        accepted,
      );

      // 6-step pipeline (#341), batched: each touched source goes through
      // writeAndReindex with broadcast/persist suppressed so the loop emits
      // a single NOTEBASE_REWRITTEN at the end. Heading-rename detection
      // still fires per-file via the hooks.
      for (const [source, content] of updatedContents) {
        await writeAndReindex(rootPath, source, content, hooks, {
          suppressRewrittenBroadcast: true,
          skipPersist: true,
        });
      }
      if (touchedPaths.length > 0) {
        await persistIndexes(rootPath);
        broadcastRewritten(rootPath, touchedPaths);
      }

      return { applied, skipped, touchedPaths };
    },
  );

  // Proposals
  ipcMain.handle(Channels.PROPOSAL_LIST, (e, status?: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return approval.listProposals(projectContext(rootPath), status);
  });
  ipcMain.handle(Channels.PROPOSAL_DETAIL, (e, uri: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return null;
    return approval.getProposal(projectContext(rootPath), uri);
  });
  ipcMain.handle(Channels.PROPOSAL_APPROVE, (e, uri: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return false;
    return approval.approveProposal(projectContext(rootPath), uri);
  });
  ipcMain.handle(Channels.PROPOSAL_REJECT, (e, uri: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return false;
    return approval.rejectProposal(projectContext(rootPath), uri);
  });
  ipcMain.handle(Channels.PROPOSAL_EXPIRE, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return 0;
    return approval.expireProposals(projectContext(rootPath));
  });

  // Conversations
  ipcMain.handle(Channels.CONVERSATION_CREATE, (_e, contextBundle: ContextBundle, triggerNodeUri?: string, options?: { systemPrompt?: string; model?: string }) =>
    conversation.create(contextBundle, triggerNodeUri, options));
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
    const rootPath = rootPathFromEvent(e);
    const controller = new AbortController();
    convAbortControllers.set(win.id, controller);

    graph.enterLLMContext();
    try {
      const conv = await conversation.appendMessage(convId, 'user', userMessage);

      const { completeWithTools } = await import('./llm/index');
      const messages = conv.messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const effectiveSystem = buildConversationSystemPrompt(
        systemPrompt ?? conv.systemPrompt,
        conv.contextBundle,
      );

      if (!rootPath) {
        throw new Error('No thoughtbase is open — cannot send conversation message.');
      }

      const result = await completeWithTools({
        system: effectiveSystem,
        messages,
        toolContext: { rootPath },
        model: conv.model,
        callbacks: {
          onChunk: (chunk: string) => {
            if (!win.isDestroyed()) {
              win.webContents.send(Channels.CONVERSATION_STREAM, chunk);
            }
          },
          signal: controller.signal,
        },
      });

      const updated = await conversation.appendMessage(
        convId,
        'assistant',
        result.text,
        { citations: result.citations },
      );
      return updated;
    } finally {
      convAbortControllers.delete(win.id);
      graph.exitLLMContext();
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

  ipcMain.handle(Channels.CONVERSATION_CRYSTALLIZE, async (e, text: string, conversationId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const convUri = `https://minerva.dev/ontology/thought#conversation/${conversationId}`;
    const conv = await conversation.load(conversationId);
    return crystallize(projectContext(rootPath), text, convUri, 'llm:crystallization', conv?.model);
  });

  ipcMain.handle(Channels.CONVERSATION_SET_MODEL, async (_e, convId: string, model: string | undefined) => {
    return conversation.setModel(convId, model);
  });

  // Slash commands in conversations
  ipcMain.handle(Channels.CONVERSATION_SLASH_COMMAND, async (e, convId: string, slashCmd: string, argText: string) => {
    const win = winFromEvent(e);
    const tool = getToolBySlashCommand(slashCmd);
    if (!tool) throw new Error(`Unknown slash command: ${slashCmd}`);

    const conv = await conversation.load(convId);
    if (!conv) throw new Error(`Conversation not found: ${convId}`);

    const ctx = {
      selectedText: argText || undefined,
      fullNoteContent: conv.contextBundle.noteContent,
      fullNotePath: conv.contextBundle.notePath,
      fullNoteTitle: conv.contextBundle.triggerNode?.label,
    };

    const prompt = tool.buildPrompt(ctx);
    await conversation.appendMessage(convId, 'user', `${slashCmd}${argText ? ' ' + argText : ''}`);

    const controller = new AbortController();
    convAbortControllers.set(win.id, controller);

    try {
      const { complete: llmComplete } = await import('./llm/index');
      const output = await llmComplete(prompt, {
        model: conv.model,
        callbacks: {
          onChunk: (chunk: string) => {
            if (!win.isDestroyed()) {
              win.webContents.send(Channels.CONVERSATION_STREAM, chunk);
            }
          },
          signal: controller.signal,
        },
      });

      await conversation.appendMessage(convId, 'assistant', output);
      return await conversation.load(convId);
    } finally {
      convAbortControllers.delete(win.id);
    }
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
      return JSON.parse(data) as unknown[];
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
