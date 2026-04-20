import { ipcMain, shell, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../shared/channels';
import * as notebaseFs from './notebase/fs';
import { renameWithLinkRewrites } from './notebase/rename';
import { renameAnchor } from './notebase/rename-anchor';
import { renameSource, renameExcerpt } from './notebase/rename-source-excerpt';
import * as gitOps from './git/index';
import * as graph from './graph/index';
import * as search from './search/index';
import * as savedQueries from './saved-queries';
import { clearRecentProjects } from './recent-projects';
import { rebuildMenu } from './menu';
import { createWindow, openProjectInWindow, closeProjectInWindow, getRootPath, markPathHandled, windowsForProject } from './window-manager';
import { executeTool, prepareConversationTool } from './tools/executor';
import { runAutoTag } from './llm/auto-tag';
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
    const { headingRenameCandidate } = await graph.indexNote(relativePath, content);
    await graph.persistGraph();
    search.indexNote(relativePath, content);
    await search.persist();
    // If a heading edit looks like a rename with affected incoming links,
    // offer to rewrite them. The renderer pops the confirmation; approval
    // routes back through NOTEBASE_RENAME_ANCHOR.
    if (headingRenameCandidate) {
      for (const targetWin of windowsForProject(rootPath)) {
        targetWin.webContents.send(Channels.NOTEBASE_HEADING_RENAME_SUGGESTED, headingRenameCandidate);
      }
    }
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

    const { transitions, rewrittenPaths } = await renameWithLinkRewrites(rootPath, oldRelPath, newRelPath, {
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith('.md')) search.indexNote(relPath, content);
      },
      removeHook: (relPath) => search.removeNote(relPath),
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

    await persistIndexes();
  });

  const broadcastRewritten = (rootPath: string, paths: string[]) => {
    if (paths.length === 0) return;
    for (const targetWin of windowsForProject(rootPath)) {
      targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, paths);
    }
  };

  ipcMain.handle(Channels.NOTEBASE_RENAME_SOURCE, async (e, oldId: string, newId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const { rewrittenPaths } = await renameSource(rootPath, oldId, newId, {
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith('.md')) search.indexNote(relPath, content);
      },
    });
    broadcastRewritten(rootPath, rewrittenPaths);
    await persistIndexes();
    return { rewrittenPaths };
  });

  ipcMain.handle(Channels.NOTEBASE_RENAME_EXCERPT, async (e, oldId: string, newId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const { rewrittenPaths } = await renameExcerpt(rootPath, oldId, newId, {
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith('.md')) search.indexNote(relPath, content);
      },
    });
    broadcastRewritten(rootPath, rewrittenPaths);
    await persistIndexes();
    return { rewrittenPaths };
  });

  ipcMain.handle(
    Channels.NOTEBASE_RENAME_ANCHOR,
    async (e, targetRelativePath: string, oldSlug: string, newSlug: string) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');

      const { rewrittenPaths } = await renameAnchor(rootPath, targetRelativePath, oldSlug, newSlug, {
        markPathHandled,
        reindexHook: (relPath, content) => {
          if (relPath.endsWith('.md')) search.indexNote(relPath, content);
        },
      });

      // Same tab-refresh pipeline as #145 — open editors for rewritten notes
      // refresh in place so the next auto-save doesn't undo the anchor rewrite.
      if (rewrittenPaths.length > 0) {
        for (const targetWin of windowsForProject(rootPath)) {
          targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, rewrittenPaths);
        }
      }

      await persistIndexes();
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

  ipcMain.handle(Channels.GRAPH_SOURCE_DETAIL, (_e, sourceId: string) => {
    return graph.getSourceDetail(sourceId);
  });

  ipcMain.handle(Channels.GRAPH_EXCERPT_SOURCE, (_e, excerptId: string) => {
    return graph.getExcerptSource(excerptId);
  });

  // Tags
  ipcMain.handle(Channels.TAGS_LIST, () => {
    return graph.listTags();
  });

  ipcMain.handle(Channels.TAGS_NOTES_BY_TAG, (_e, tag: string) => {
    return graph.notesByTag(tag);
  });

  ipcMain.handle(Channels.TAGS_SOURCES_BY_TAG, (_e, tag: string) => {
    return graph.sourcesByTag(tag);
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
  ipcMain.handle(Channels.INSPECTIONS_LIST, () => healthChecks.getInspections());
  ipcMain.handle(Channels.INSPECTIONS_RUN, () => healthChecks.runAllChecks());

  // Grounding check — fuzzy match a claim against graph labels
  ipcMain.handle(Channels.GRAPH_GROUND_CHECK, async (_e, claimText: string) => {
    const escaped = claimText.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const results = await graph.queryGraph(`
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

  ipcMain.handle(Channels.TOOL_PREPARE_CONVERSATION, (_e, request: ToolExecutionRequest) =>
    prepareConversationTool(request));

  ipcMain.handle(Channels.REFACTOR_AUTO_TAG, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');

    const plan = await runAutoTag(rootPath, relativePath);
    if (!plan.content) return { added: [] };

    // Route the write through the standard index + search + broadcast path,
    // so open tabs of the tagged note refresh via NOTEBASE_REWRITTEN (same
    // conflict handling as a link rewrite).
    markPathHandled(relativePath);
    await notebaseFs.writeFile(rootPath, relativePath, plan.content);
    await graph.indexNote(relativePath, plan.content);
    search.indexNote(relativePath, plan.content);
    await persistIndexes();
    broadcastRewritten(rootPath, [relativePath]);
    return { added: plan.added };
  });

  // Proposals
  ipcMain.handle(Channels.PROPOSAL_LIST, (_e, status?: string) => approval.listProposals(status));
  ipcMain.handle(Channels.PROPOSAL_DETAIL, (_e, uri: string) => approval.getProposal(uri));
  ipcMain.handle(Channels.PROPOSAL_APPROVE, (_e, uri: string) => approval.approveProposal(uri));
  ipcMain.handle(Channels.PROPOSAL_REJECT, (_e, uri: string) => approval.rejectProposal(uri));
  ipcMain.handle(Channels.PROPOSAL_EXPIRE, () => approval.expireProposals());

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
    const conv = await conversation.load(conversationId);
    return crystallize(text, convUri, 'llm:crystallization', conv?.model);
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
