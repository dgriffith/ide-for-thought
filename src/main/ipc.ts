import { ipcMain, shell, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Channels } from '../shared/channels';
import * as notebaseFs from './notebase/fs';
import { isIndexable } from './notebase/indexable-files';
import { renameWithLinkRewrites } from './notebase/rename';
import { mergeNotes, previewMergeNotes } from './notebase/merge';
import { renameAnchor } from './notebase/rename-anchor';
import { renameSource, renameExcerpt } from './notebase/rename-source-excerpt';
import * as gitOps from './git/index';
import * as graph from './graph/index';
import { projectContext, type ProjectContext } from './project-context-types';
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
import {
  formatNoteContent,
  formatFile as formatFileOnDisk,
  formatFolder as formatFolderOnDisk,
} from './formatter/orchestrator';
import { ingestUrl } from './sources/ingest';
import * as tables from './sources/tables';
import { ingestIdentifier } from './sources/ingest-identifier';
import {
  listSites as listPrivilegedSites,
  addSite as addPrivilegedSite,
  removeSite as removePrivilegedSite,
  logoutSite as logoutPrivilegedSite,
  openLoginWindow as openPrivilegedLogin,
  privilegedFetch,
} from './privileged-sites';
import { generateBibliography } from './bibliography/generate';
import {
  getBibliographyStyleId,
  setBibliographyStyleId,
  getPythonTrust,
  setPythonTrust,
  getOnboardingDismissed,
  setOnboardingDismissed,
} from './project-config';
import { DEFAULT_STYLE } from './publish/csl/assets';
import { buildCitationAudit } from './publish/csl/audit';
import {
  loadUserStyles,
  loadUserLocales,
  getMergedStyles,
  getMergedLocales,
  isValidCslStyle,
  isValidCslLocale,
  extractStyleTitle,
  deriveStyleId,
  deriveLocaleId,
  USER_STYLES_DIR,
  USER_LOCALES_DIR,
} from './publish/csl/user-assets';
import { renderInlineCitations, type InlineCiteRequest } from './citations/render-inline';
import { ingestPdf, finishPdfOcrIngest, readOriginalPdf } from './sources/ingest-pdf';
import { deleteSource } from './sources/delete-source';
import { mergeSources, MergeSourcesError } from './sources/merge-sources';
import { setSourceReadStatus, setSourceReadDueBy } from './sources/read-status';
import type { ReadStatus } from '../shared/types';
import type { ReadingQueueView } from './graph/index';
import {
  loadCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  addSourceToCollection,
  removeSourceFromCollection,
  createSmartCollection,
  renameSmartCollection,
  deleteSmartCollection,
  updateSmartCollectionPredicate,
  resolveSmartMembers,
} from './sources/collections';
import type { SmartCollectionPredicate } from '../shared/types';
import { importBibtex } from './sources/import-bibtex';
import { importZoteroRdf } from './sources/import-zotero-rdf';
import { dropImport } from './notebase/drop-import';
import { searchInNotes, replaceInNotes, type SearchOptions, type ReplaceSelection } from './notebase/search-in-notes';
import { runCell as runComputeCell, registeredLanguages as computeLanguages } from './compute/registry';
import { restartKernel as restartPythonKernel, interruptKernel as interruptPythonKernel } from './compute/python-kernel';
import {
  getPythonSettings,
  setPythonSettings,
  probePythonInterpreter,
  resolvePythonInterpreter,
  type PythonSettings,
} from './compute/python-settings';
import { saveCellOutput, type SaveCellOutputInput } from './compute/save-cell-output';
import * as publish from './publish';
import { createExcerpt } from './sources/create-excerpt';
import type { FormatSettings } from '../shared/formatter/engine';
import type { AutoLinkSuggestion } from '../shared/refactor/auto-link';
import type { AutoLinkInboundSuggestion } from '../shared/refactor/auto-link-inbound';
import { patchFrontmatterProperties } from '../shared/refactor/frontmatter-patch';
import * as healthChecks from './graph/health-checks';
import '../shared/tools/definitions/index';
import { getSettings, saveSettings } from './llm/settings';
import type { ToolExecutionRequest, LLMSettings } from '../shared/tools/types';
import type { TabSession } from '../shared/types';
import * as approval from './llm/approval';
import * as conversation from './llm/conversation';
import type { ContextBundle, ConversationMessage } from '../shared/types';

function winFromEvent(e: Electron.IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(e.sender)!;
}

const DEFAULT_CONVERSATION_SYSTEM_PROMPT = [
  'You are an assistant embedded in Minerva, a markdown-based thinking tool.',
  'The user is working inside a thoughtbase: a collection of interlinked notes backed by an RDF knowledge graph.',
  '',
  'You have read tools, web tools, and two write tools (propose_notes, propose_sources). Prefer the thoughtbase tools for anything inside the user\'s notes; use the web tools for facts, events, documentation, or sources outside the thoughtbase.',
  '',
  'Thoughtbase read tools:',
  '- search_notes: full-text search across the thoughtbase.',
  '- read_note: read a specific note by its relative path.',
  '- query_graph: run a SPARQL query against the knowledge graph (minerva/thought prefixes are auto-injected).',
  '- describe_graph_schema: fetch the full ontology TTL. Call this before writing a non-trivial SPARQL query if you are unsure about class or predicate names.',
  '',
  'Thoughtbase write tools:',
  '- propose_notes: file one or more notes for the user to review. The user sees an inline draft card with Approve/Discard. **You MUST call this tool — do NOT just describe the notes in chat and ask the user to file them, and do NOT tell them you can\'t create notes.** If you have just outlined a structure (a learning journey, a topic breakdown, a per-section explanation, a multi-claim summary), and the user wants it filed, call propose_notes with the whole bundle in one call (parent + children). The trust principle is preserved: nothing lands until the user clicks Approve.',
  '- propose_sources: file one or more sources (papers, articles, web pages) into the user\'s Sources library. The user sees an inline draft card with Approve/Discard; on Approve, Minerva runs its full ingest pipeline (Crossref / arXiv / PubMed for identifiers; Readability for URLs) to fetch metadata and archive the source. **Prefer identifiers (DOI / arXiv id / PubMed id) over URLs** — the structured metadata is richer. Duplicates are skipped automatically. Use this when you have referenced a specific external work, when the user asks to add a citation, or when web_search surfaced sources that materially advance the conversation.',
  '',
  'Web tools:',
  '- web_search: search the web for current information, news, documentation, or external references.',
  '- web_fetch: fetch the contents of a specific URL — use this after web_search to read a promising result in full, or when the user gives you a URL directly.',
  '',
  'Minerva-specific markdown features (use these in note bodies whenever they materially help — and in inline reply examples if the user is asking how to use the feature):',
  '- ```python (also ```py, ```python3) — runnable Python cell. The user clicks the ▶ gutter icon (or Cmd/Ctrl+Shift+Enter) to execute; results land in a sibling ```output``` block that the editor manages. A persistent per-note kernel preserves variables across cells in the same note. The project root is on `sys.path`, so any `.py` file in the notebase is importable — `helpers.py` at the root → `import helpers`; `python/utils.py` → `from python import utils`. Reach for `propose_notes` with a `.py` payload when reusable logic emerges (helper functions, shared loaders, plotting wrappers). Heads-up: the kernel caches imported modules, so after editing a `.py` helper the user needs to restart the kernel for changes to land in already-imported cells (Compute menu → Restart Python Kernel).',
  '- ```sparql — runnable SPARQL query against the user\'s knowledge graph. Standard prefixes (minerva, thought, dc, rdf, rdfs, xsd, csvw, prov) are auto-injected, so write only the SELECT/ASK/CONSTRUCT body. Same run mechanism.',
  '- ```sql — runnable SQL query (DuckDB) against tables. Markdown tables in the user\'s notes become queryable via CSVW; column headers become the schema. Same run mechanism.',
  '- ```mermaid — rendered inline as an SVG diagram in preview (flowcharts, sequence diagrams, ER diagrams, state diagrams, etc.). Use for structural overviews where a picture beats prose.',
  '- ```turtle — Turtle-RDF that is parsed into the note\'s named graph at save time. Use sparingly, and only for genuinely structured facts the user will want to query later (e.g. a `thought:Claim` with `thought:supports`/`thought:rebuts` links). Do NOT use it as a dumping ground for arbitrary metadata.',
  'Do NOT pre-fill a ```output``` block — leave outputs for the user to generate by running the cell. Reach for these features when they earn their keep; a plain prose answer is often better.',
  '',
  'Usage guidance:',
  '- For questions about the user\'s notes or ideas they\'ve captured, use search_notes and read_note.',
  '- For structural questions (what links to what, which notes share a tag, which claims cite a source), use query_graph; fall back to describe_graph_schema if a query fails or you are guessing at predicates.',
  '- For current events, external facts, recent research, or things outside the thoughtbase, use web_search.',
  '- It\'s often useful to combine tools: search_notes to see what the user already has, then web_search to fill in what they don\'t. Cite your web sources.',
  '- When the user agrees to file something ("yes, file it", "file these as notes", "save this", "create the notes"), CALL propose_notes immediately — do not describe what you would file, do not ask for further confirmation. The Approve/Discard card IS the user\'s confirmation step.',
  '- When the user agrees to add sources ("add that paper", "save this source", "ingest this", "add the citation"), CALL propose_sources immediately with the relevant identifiers/URLs. The Approve/Discard card IS the user\'s confirmation step.',
  '',
  'When you call propose_notes or propose_sources, do NOT also paste the same content / URL list inline in your reply. The inline draft card is the deliverable; repeating it is duplicate noise.',
  '',
  'Answer in GitHub-flavored markdown. When you reference a note, cite its relative path so the user can open it.',
].join('\n');

function buildConversationSystemPrompt(
  userSystem: string | undefined,
  contextBundle: ContextBundle,
  currentNotePath?: string,
): string {
  const parts = [DEFAULT_CONVERSATION_SYSTEM_PROMPT];
  if (contextBundle.notePath) {
    parts.push('', `The user started this conversation from the note: ${contextBundle.notePath}`);
  }
  if (currentNotePath && currentNotePath !== contextBundle.notePath) {
    // Live context — the note the user is currently looking at, which may
    // differ from the conversation's origin. Resolves "this note" / "the
    // current note" in the user's prompts against what they're actually
    // viewing.
    parts.push('', `The note currently open in the editor is: ${currentNotePath}`);
  } else if (currentNotePath && currentNotePath === contextBundle.notePath) {
    parts.push('', 'The user is still viewing the origin note.');
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

// ── propose_compute helpers (#245) ──────────────────────────────────────────

/**
 * Serialize a CellResult into a plain-text block the LLM can read on
 * its next turn. Tables get a small markdown rendering (capped at
 * ~30 rows for sanity); errors get a single-line marker; images are
 * referenced by a placeholder since the API can't see them inline
 * here. The returned string is wrapped with `[Output of <draftId>]`
 * delimiters so the LLM (and a human reading the transcript) can
 * locate the section quickly.
 */
function formatComputeResultAsContext(
  draft: import('../shared/conversation-compute-drafts').ConversationComputeDraft,
  codeRan: string,
  result: import('../shared/compute/types').CellResult,
): string {
  const header = `[Output of compute proposal ${draft.draftId} — ${draft.language}]`;
  const codeBlock = `\`\`\`${draft.language}\n${codeRan.trim()}\n\`\`\``;
  if (!result.ok) {
    return `${header}\n${codeBlock}\n\n**Error:** ${result.error}`;
  }
  const out = result.output;
  switch (out.type) {
    case 'text':
      return `${header}\n${codeBlock}\n\n\`\`\`\n${out.value}\n\`\`\``;
    case 'json':
      return `${header}\n${codeBlock}\n\n\`\`\`json\n${JSON.stringify(out.value, null, 2)}\n\`\`\``;
    case 'table': {
      const ROW_CAP = 30;
      const rows = out.rows.slice(0, ROW_CAP);
      const head = `| ${out.columns.join(' | ')} |`;
      const sep = `| ${out.columns.map(() => '---').join(' | ')} |`;
      const body = rows
        .map((r) => `| ${r.map((c) => formatTableCell(c)).join(' | ')} |`)
        .join('\n');
      const trailer = out.truncated || out.rows.length > ROW_CAP
        ? `\n\n(showing ${rows.length} of ${out.totalRows ?? out.rows.length} rows)`
        : '';
      return `${header}\n${codeBlock}\n\n${head}\n${sep}\n${body}${trailer}`;
    }
    case 'image':
      return `${header}\n${codeBlock}\n\n[image output: ${out.mime} — open the conversation panel to view]`;
    case 'html':
      // Pass HTML through verbatim; the LLM can read the markup but
      // won't render it. Truncate to a sane length so a giant table
      // doesn't blow up the next turn's context.
      return `${header}\n${codeBlock}\n\n\`\`\`html\n${out.html.slice(0, 4000)}\n\`\`\``;
  }
}

function formatTableCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  // Anything else (Date, object literal, etc.) — JSON-stringify
  // rather than risk "[object Object]" landing in the LLM context.
  try { return JSON.stringify(value); } catch { return ''; }
}

/**
 * Write the ComputeProposal triples into the graph. Called from the
 * RUN handler so every executed cell leaves an audit-trail record —
 * the integrity stock query verifies the LLM hasn't snuck a cell
 * past review.
 */
function recordComputeProposalRun(
  ctx: ProjectContext,
  draft: import('../shared/conversation-compute-drafts').ConversationComputeDraft,
  codeRan: string,
): void {
  const proposalUri = `https://minerva.dev/ontology/thought#proposal/${draft.draftId}`;
  const convUri = `https://minerva.dev/ontology/thought#conversation/${draft.conversationId}`;
  const executedAt = new Date().toISOString();
  const turtle = `
    @prefix thought: <https://minerva.dev/ontology/thought#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

    <${proposalUri}> a thought:ComputeProposal ;
      thought:proposalStatus thought:approved ;
      thought:proposedBy "llm:propose_compute" ;
      thought:proposedAt "${draft.createdAt}"^^xsd:dateTime ;
      thought:conversationRef <${convUri}> ;
      thought:language "${escapeTurtleLiteral(draft.language)}" ;
      thought:code "${escapeTurtleLiteral(draft.code)}" ;
      thought:executedCode "${escapeTurtleLiteral(codeRan)}" ;
      thought:executed "true"^^xsd:boolean ;
      thought:executedAt "${executedAt}"^^xsd:dateTime .
  `;
  graph.parseIntoStore(ctx, turtle);
}

function escapeTurtleLiteral(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

/**
 * Build the markdown block for an Insert-into-notebook action. The
 * provenance comment line is parsed by the indexer when the LLM
 * later asks `read_note` on the destination — it sees the comment
 * and knows which cells were LLM-proposed vs. human-written.
 */
function buildComputeProposalNoteBlock(
  draft: import('../shared/conversation-compute-drafts').ConversationComputeDraft,
  codeToInsert: string,
): string {
  const provenance = [
    `<!-- compute-proposal:`,
    `  draft: ${draft.draftId}`,
    `  proposed_by: llm`,
    `  proposed_in_conversation: ${draft.conversationId}`,
    `  proposed_at: ${draft.createdAt}`,
    `  rationale: ${draft.rationale.replace(/-->/g, '--&gt;')}`,
    `-->`,
  ].join('\n');
  const fence = '```';
  return `${provenance}\n${fence}${draft.language}\n${codeToInsert.trim()}\n${fence}`;
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

  ipcMain.handle(Channels.NOTEBASE_READ_BINARY, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    // Pass the bytes back as a Buffer; Electron's structured-clone
    // bridge wraps it in a Uint8Array on the renderer side.
    return notebaseFs.readBinaryFile(rootPath, relativePath);
  });

  ipcMain.handle(Channels.NOTEBASE_WRITE_BINARY, async (e, relativePath: string, bytes: Uint8Array) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    // The renderer wraps payload as a Uint8Array; structured-clone
    // hands us a Buffer at this end. Either way `writeBinaryFile`
    // re-wraps as a strict Uint8Array view.
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await notebaseFs.writeBinaryFile(rootPath, relativePath, view);
  });

  ipcMain.handle(Channels.NOTEBASE_FILE_EXISTS, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return false;
    return notebaseFs.fileExists(rootPath, relativePath);
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

  ipcMain.handle(Channels.NOTEBASE_MERGE_PREVIEW, async (e, sourceRelPath: string, targetRelPath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return previewMergeNotes(rootPath, sourceRelPath, targetRelPath);
  });

  ipcMain.handle(Channels.NOTEBASE_MERGE, async (e, sourceRelPath: string, targetRelPath: string, separator?: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const ctx = projectContext(rootPath);
    const result = await mergeNotes(rootPath, sourceRelPath, targetRelPath, {
      separator,
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith('.md')) search.indexNote(ctx, relPath, content);
      },
      removeHook: (relPath) => search.removeNote(ctx, relPath),
    });
    // Broadcast: source disappeared (RENAMED with one transition signals
    // editor tabs to drop / reroute) plus the rewritten set so other
    // windows reload affected files.
    for (const targetWin of windowsForProject(rootPath)) {
      targetWin.webContents.send(Channels.NOTEBASE_RENAMED, [
        { old: sourceRelPath, new: '' /* sentinel: deletion */ },
      ]);
      if (result.rewrittenPaths.length > 0) {
        targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, [
          ...result.rewrittenPaths,
          targetRelPath,
        ]);
      } else {
        targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, [targetRelPath]);
      }
    }
    await persistIndexes(rootPath);
    return result;
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

  ipcMain.handle(
    Channels.LINKS_CITATIONS_FOR_NOTE,
    async (e, relativePath: string, content?: string) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) return [];
      // Renderer can pass live content (current editor buffer) so the
      // count reflects what the user is typing right now. Falling back
      // to disk preserves correctness when the panel refreshes from a
      // graph event without an open editor buffer.
      const text = content ?? await notebaseFs.readFile(rootPath, relativePath).catch(() => '');
      return graph.citationsForNote(projectContext(rootPath), relativePath, text);
    },
  );

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

  ipcMain.handle(Channels.GRAPH_ALIAS_MAP, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return {};
    return graph.getAliasMap(projectContext(rootPath));
  });

  ipcMain.handle(Channels.GRAPH_ALIAS_ENTRIES, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.getAliasEntries(projectContext(rootPath));
  });

  ipcMain.handle(Channels.GRAPH_FRONTMATTER_KEYS, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.getAllFrontmatterKeys(projectContext(rootPath));
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

  // Privileged sites
  ipcMain.handle(Channels.SITES_LIST, () => listPrivilegedSites());
  ipcMain.handle(Channels.SITES_ADD, (_e, domain: string, label?: string) =>
    addPrivilegedSite(domain, label),
  );
  ipcMain.handle(Channels.SITES_REMOVE, (_e, id: string) => removePrivilegedSite(id));
  ipcMain.handle(Channels.SITES_LOGIN, async (_e, id: string) => {
    await openPrivilegedLogin(id);
  });
  ipcMain.handle(Channels.SITES_LOGOUT, (_e, id: string) => logoutPrivilegedSite(id));

  // Bibliography (#113)
  ipcMain.handle(Channels.BIBLIOGRAPHY_LIST_STYLES, async (e) => {
    const rootPath = rootPathFromEvent(e);
    // Settings dialog opens before any project is loaded in some flows;
    // fall back to the bundled set so the picker isn't empty.
    const merged = rootPath
      ? await getMergedStyles(rootPath)
      : await getMergedStyles('');
    return Object.keys(merged.styles).map((id) => ({
      id,
      label: merged.labels[id] ?? id,
      isUser: merged.userIds.has(id),
    }));
  });
  ipcMain.handle(Channels.BIBLIOGRAPHY_GET_STYLE, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return DEFAULT_STYLE;
    return getBibliographyStyleId(rootPath) ?? DEFAULT_STYLE;
  });
  ipcMain.handle(Channels.BIBLIOGRAPHY_SET_STYLE, async (e, styleId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const merged = await getMergedStyles(rootPath);
    if (!Object.prototype.hasOwnProperty.call(merged.styles, styleId)) {
      throw new Error(`Unknown CSL style: ${styleId}`);
    }
    setBibliographyStyleId(rootPath, styleId);
  });

  // User-imported CSL styles + locales (#302)
  ipcMain.handle(Channels.CSL_LIST_USER_STYLES, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return (await loadUserStyles(rootPath)).map((s) => ({
      id: s.id,
      label: s.label,
      filePath: s.filePath,
    }));
  });
  ipcMain.handle(Channels.CSL_LIST_USER_LOCALES, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return (await loadUserLocales(rootPath)).map((l) => ({
      id: l.id,
      filePath: l.filePath,
    }));
  });
  ipcMain.handle(Channels.CSL_IMPORT_STYLE, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const win = winFromEvent(e);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'CSL style', extensions: ['csl', 'xml'] }],
      title: 'Import CSL style',
      buttonLabel: 'Import',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const sourcePath = result.filePaths[0];
    const xml = await fs.readFile(sourcePath, 'utf-8');
    if (!isValidCslStyle(xml)) {
      throw new Error('File is not a valid CSL style (missing <style> element with the CSL namespace).');
    }
    const id = deriveStyleId(path.basename(sourcePath));
    if (!id) throw new Error('Could not derive a style id from the filename.');
    const destDir = path.join(rootPath, USER_STYLES_DIR);
    await fs.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, `${id}.csl`);
    await fs.writeFile(destPath, xml, 'utf-8');
    return { id, label: extractStyleTitle(xml) ?? id, filePath: destPath };
  });
  ipcMain.handle(Channels.CSL_IMPORT_LOCALE, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const win = winFromEvent(e);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'CSL locale', extensions: ['xml'] }],
      title: 'Import CSL locale',
      buttonLabel: 'Import',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const sourcePath = result.filePaths[0];
    const xml = await fs.readFile(sourcePath, 'utf-8');
    if (!isValidCslLocale(xml)) {
      throw new Error('File is not a valid CSL locale (missing <locale> element with the CSL namespace).');
    }
    const id = deriveLocaleId(path.basename(sourcePath));
    if (!id) throw new Error('Could not derive a locale id from the filename.');
    const destDir = path.join(rootPath, USER_LOCALES_DIR);
    await fs.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, `${id}.xml`);
    await fs.writeFile(destPath, xml, 'utf-8');
    return { id, filePath: destPath };
  });
  ipcMain.handle(Channels.CSL_REMOVE_STYLE, async (e, id: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error('Invalid style id.');
    const target = path.join(rootPath, USER_STYLES_DIR, `${id}.csl`);
    await fs.unlink(target).catch(() => undefined);
  });
  ipcMain.handle(Channels.CSL_REMOVE_LOCALE, async (e, id: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid locale id.');
    const target = path.join(rootPath, USER_LOCALES_DIR, `${id}.xml`);
    await fs.unlink(target).catch(() => undefined);
  });
  ipcMain.handle(Channels.CITATION_RENDER_INLINE, async (e, refs: InlineCiteRequest[]) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) {
      return { markers: [], bibliography: null, missing: [], styleId: DEFAULT_STYLE };
    }
    return await renderInlineCitations(rootPath, refs ?? []);
  });

  ipcMain.handle(Channels.BIBLIOGRAPHY_GENERATE, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const original = await notebaseFs.readFile(rootPath, relativePath);
    const result = await generateBibliography(rootPath, original);
    if (result.changed) {
      // 6-step pipeline keeps graph + search + open editors in sync
      // with on-disk content, just like a manual save.
      await writeAndReindex(rootPath, relativePath, result.content, hooks);
    }
    return {
      entriesCount: result.entriesCount,
      missingIds: result.missingIds,
      changed: result.changed,
      styleId: result.styleId,
    };
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
    return await ingestUrl(rootPath, url, { fetchImpl: privilegedFetch });
  });

  ipcMain.handle(Channels.SOURCES_INGEST_IDENTIFIER, async (e, identifier: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return await ingestIdentifier(rootPath, identifier, { fetchImpl: privilegedFetch });
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

  ipcMain.handle(Channels.COMPUTE_INTERRUPT_PYTHON, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { ok: false, reason: 'no-kernel' };
    return interruptPythonKernel(rootPath);
  });

  ipcMain.handle(Channels.COMPUTE_GET_PYTHON_SETTINGS, async () => {
    return await getPythonSettings();
  });

  ipcMain.handle(Channels.COMPUTE_SET_PYTHON_SETTINGS, async (_e, settings: PythonSettings) => {
    await setPythonSettings({
      pythonPath: typeof settings?.pythonPath === 'string' ? settings.pythonPath : '',
    });
  });

  ipcMain.handle(Channels.COMPUTE_PROBE_PYTHON, async (_e, candidate?: string) => {
    // Empty `candidate` → probe the same interpreter the resolver
    // would pick right now (override → env var → python3). That's
    // the "active" interpreter the Settings status line surfaces.
    const target = candidate?.trim() ? candidate : await resolvePythonInterpreter();
    return await probePythonInterpreter(target);
  });

  ipcMain.handle(Channels.COMPUTE_GET_PYTHON_TRUST, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return false;
    return getPythonTrust(rootPath);
  });

  ipcMain.handle(Channels.COMPUTE_SET_PYTHON_TRUST, (e, trusted: boolean) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    setPythonTrust(rootPath, trusted === true);
  });

  ipcMain.handle(Channels.NOTEBASE_GET_ONBOARDING_DISMISSED, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return false;
    return getOnboardingDismissed(rootPath);
  });

  ipcMain.handle(Channels.NOTEBASE_SET_ONBOARDING_DISMISSED, (e, dismissed: boolean) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    setOnboardingDismissed(rootPath, dismissed === true);
  });

  ipcMain.handle(Channels.COMPUTE_BROWSE_PYTHON, async (e) => {
    const win = winFromEvent(e);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose Python interpreter',
      // No file-extension filter — a Python binary on macOS / Linux
      // typically has no extension, and a venv shim is just `python`
      // or `python3`. The probe step that follows verifies the pick
      // is actually runnable, so over-permissive picking is fine.
      properties: ['openFile', 'showHiddenFiles', 'noResolveAliases'],
      buttonLabel: 'Use this interpreter',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
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
    citationStyle?: string;
    citationLocale?: string;
    forceInclude?: string[];
    forceExclude?: string[];
  }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const plan = await publish.resolvePlan(rootPath, input, {
      linkPolicy: opts?.linkPolicy,
      citationStyle: opts?.citationStyle,
      citationLocale: opts?.citationLocale,
      forceInclude: opts?.forceInclude,
      forceExclude: opts?.forceExclude,
    });
    // Strip `content` + `frontmatter` from the wire payload — the preview
    // only needs to audit paths, kinds, and exclusion reasons; loading
    // every file's text over IPC is wasteful.
    const exporter = opts?.exporterId ? publish.getExporter(opts.exporterId) : null;
    const audit = plan.citations
      ? buildCitationAudit(plan.inputs, plan.citations)
      : { bySource: [], missing: [] };
    // Project-scoped registry: bundled + user-imported (#302). Exposed
    // through the preview so the picker reflects whatever the user has
    // dropped in, without a separate roundtrip.
    const merged = await getMergedStyles(rootPath);
    const mergedLocales = await getMergedLocales(rootPath);
    return {
      exporterId: exporter?.id ?? '',
      exporterLabel: exporter?.label ?? '',
      inputs: plan.inputs.map((f) => ({
        relativePath: f.relativePath,
        kind: f.kind,
        title: f.title,
        overridden: f.overridden ?? false,
      })),
      excluded: plan.excluded,
      citations: {
        styleId: plan.citations?.styleId ?? DEFAULT_STYLE,
        localeId: plan.citations?.localeId ?? 'en-US',
        availableStyles: Object.keys(merged.styles).map((id) => ({
          id,
          label: merged.labels[id] ?? id,
        })),
        availableLocales: Object.keys(mergedLocales.locales).map((id) => ({ id, label: id })),
        bySource: audit.bySource,
        missing: audit.missing,
      },
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

  ipcMain.handle(Channels.SOURCES_MERGE, async (e, params: { srcId: string; destId: string }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    try {
      const result = await mergeSources(rootPath, params.srcId, params.destId);
      await persistIndexes(rootPath);
      const win = winFromEvent(e);
      if (!win.isDestroyed()) {
        win.webContents.send(Channels.SOURCES_CHANGED);
        win.webContents.send(Channels.EXCERPTS_CHANGED);
      }
      return result;
    } catch (err) {
      if (err instanceof MergeSourcesError) {
        // Carry the structured code through to the renderer so the UI
        // can distinguish a same-source / not-found error from a real crash.
        const wrapped = new Error(err.message);
        (wrapped as Error & { code?: string }).code = err.code;
        throw wrapped;
      }
      throw err;
    }
  });

  // ── Reading queue (#116) ──────────────────────────────────────────────────
  ipcMain.handle(Channels.SOURCES_SET_READ_STATUS, async (e, params: { sourceId: string; status: ReadStatus | null }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await setSourceReadStatus(rootPath, params.sourceId, params.status);
    await persistIndexes(rootPath);
    const win = winFromEvent(e);
    if (!win.isDestroyed()) win.webContents.send(Channels.SOURCES_CHANGED);
  });

  ipcMain.handle(Channels.SOURCES_SET_READ_DUE_BY, async (e, params: { sourceId: string; dueBy: string | null }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await setSourceReadDueBy(rootPath, params.sourceId, params.dueBy);
    await persistIndexes(rootPath);
    const win = winFromEvent(e);
    if (!win.isDestroyed()) win.webContents.send(Channels.SOURCES_CHANGED);
  });

  ipcMain.handle(Channels.SOURCES_QUEUE_MEMBERS, (e, view: ReadingQueueView) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    const ctx = projectContext(rootPath);
    const ids = new Set(graph.getReadingQueueSourceIds(ctx, view));
    if (ids.size === 0) return [];
    return graph.listAllSources(ctx).filter((s) => ids.has(s.sourceId));
  });

  // ── Collections (#470) ────────────────────────────────────────────────────
  const broadcastCollectionsChanged = (e: Electron.IpcMainInvokeEvent) => {
    const win = winFromEvent(e);
    if (!win.isDestroyed()) win.webContents.send(Channels.COLLECTIONS_CHANGED);
  };

  ipcMain.handle(Channels.COLLECTIONS_LIST, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { collections: [] };
    return await loadCollections(rootPath);
  });

  ipcMain.handle(Channels.COLLECTIONS_CREATE, async (e, args: { name: string; parent?: string | null }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const result = await createCollection(rootPath, args);
    broadcastCollectionsChanged(e);
    return result;
  });

  ipcMain.handle(Channels.COLLECTIONS_RENAME, async (e, args: { id: string; name: string }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await renameCollection(rootPath, args.id, args.name);
    broadcastCollectionsChanged(e);
  });

  ipcMain.handle(Channels.COLLECTIONS_DELETE, async (e, id: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await deleteCollection(rootPath, id);
    broadcastCollectionsChanged(e);
  });

  ipcMain.handle(Channels.COLLECTIONS_ADD_SOURCE, async (e, args: { collectionId: string; sourceId: string }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await addSourceToCollection(rootPath, args.collectionId, args.sourceId);
    broadcastCollectionsChanged(e);
  });

  ipcMain.handle(Channels.COLLECTIONS_REMOVE_SOURCE, async (e, args: { collectionId: string; sourceId: string }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await removeSourceFromCollection(rootPath, args.collectionId, args.sourceId);
    broadcastCollectionsChanged(e);
  });

  ipcMain.handle(Channels.COLLECTIONS_CREATE_SMART, async (e, args: { name: string; predicate: SmartCollectionPredicate }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const result = await createSmartCollection(rootPath, args);
    broadcastCollectionsChanged(e);
    return result;
  });

  ipcMain.handle(Channels.COLLECTIONS_RENAME_SMART, async (e, args: { id: string; name: string }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await renameSmartCollection(rootPath, args.id, args.name);
    broadcastCollectionsChanged(e);
  });

  ipcMain.handle(Channels.COLLECTIONS_DELETE_SMART, async (e, id: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await deleteSmartCollection(rootPath, id);
    broadcastCollectionsChanged(e);
  });

  ipcMain.handle(Channels.COLLECTIONS_UPDATE_SMART_PREDICATE, async (e, args: { id: string; predicate: SmartCollectionPredicate }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    await updateSmartCollectionPredicate(rootPath, args.id, args.predicate);
    broadcastCollectionsChanged(e);
  });

  ipcMain.handle(Channels.COLLECTIONS_SMART_MEMBERS, async (e, id: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    const data = await loadCollections(rootPath);
    const smart = data.smartCollections.find((s) => s.id === id);
    if (!smart) return [];
    const ctx = projectContext(rootPath);
    // Resolve via the graph's existing source-by-tag helper. The graph
    // is the source of truth for hasTag edges (notes + sources) so we
    // get the same membership semantics the tag panel surfaces.
    const matchingIds = resolveSmartMembers(smart.predicate, {
      sourcesByTag: (tag) => graph.sourcesByTag(ctx, tag),
      sourcesByReadStatus: (status) => graph.sourcesByReadStatus(ctx, status),
    });
    if (matchingIds.size === 0) return [];
    const all = graph.listAllSources(ctx);
    return all.filter((s) => matchingIds.has(s.sourceId));
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
  ipcMain.handle(Channels.PROPOSAL_APPROVE, async (e, uri: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return false;
    const result = await approval.approveProposal(projectContext(rootPath), uri);
    return result.ok;
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
  ipcMain.handle(Channels.CONVERSATION_ARCHIVE, (_e, id: string) => conversation.archive(id));
  ipcMain.handle(Channels.CONVERSATION_LOAD, (_e, id: string) => conversation.load(id));
  ipcMain.handle(Channels.CONVERSATION_LIST, () => conversation.listAll());
  ipcMain.handle(Channels.CONVERSATION_LIST_ACTIVE, () => conversation.listActive());
  ipcMain.handle(Channels.CONVERSATION_UI_STATE_LOAD, () => conversation.loadUIState());
  ipcMain.handle(
    Channels.CONVERSATION_UI_STATE_SAVE,
    (_e, state: import('../shared/types').ConversationsUIState) => conversation.saveUIState(state),
  );

  // Conversation send + LLM streaming
  const convAbortControllers = new Map<number, AbortController>();
  // Pending ask_user prompts keyed by question id. The CONVERSATION_SEND
  // handler creates an entry when the agent calls ask_user, and the
  // CONVERSATION_ASK_USER_REPLY handler resolves (or rejects) it. Aborting
  // the send rejects every pending question for that window so the agent
  // loop unwinds cleanly instead of hanging on an answered-never promise.
  const pendingAskUser = new Map<string, { winId: number; resolve: (answer: string) => void; reject: (err: Error) => void }>();

  ipcMain.handle(Channels.CONVERSATION_ASK_USER_REPLY, (_e, questionId: string, answer: string) => {
    const pending = pendingAskUser.get(questionId);
    if (!pending) return;
    pendingAskUser.delete(questionId);
    pending.resolve(answer);
  });

  ipcMain.handle(Channels.CONVERSATION_SEND, async (e, convId: string, userMessage: string, systemPrompt?: string, currentNotePath?: string, extraTools?: import('../shared/conversation-tools').ConversationToolKey[]) => {
    const win = winFromEvent(e);
    const rootPath = rootPathFromEvent(e);
    const controller = new AbortController();
    convAbortControllers.set(win.id, controller);
    // When this send is aborted, fail any in-flight ask_user prompts so
    // the agent's tool-call loop unwinds.
    controller.signal.addEventListener('abort', () => {
      for (const [qid, pending] of pendingAskUser) {
        if (pending.winId === win.id) {
          pendingAskUser.delete(qid);
          pending.reject(new Error('aborted'));
        }
      }
    });

    // Unconditional log so we can prove the current build is loaded —
    // if the user reports "no log messages" again, this is missing too.
    console.log(`[conv] SEND start: conv=${convId} userMsgLen=${userMessage.length}`);

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
        currentNotePath,
      );

      if (!rootPath) {
        throw new Error('No thoughtbase is open — cannot send conversation message.');
      }

      const streamCallbacks = {
        onChunk: (chunk: string) => {
          if (!win.isDestroyed()) {
            win.webContents.send(Channels.CONVERSATION_STREAM, chunk);
          }
        },
        onDraft: (draft: import('../shared/conversation-drafts').ConversationDraft) => {
          if (!win.isDestroyed()) {
            win.webContents.send(Channels.CONVERSATION_DRAFT, draft);
          }
        },
        onSourceDraft: (draft: import('../shared/conversation-source-drafts').ConversationSourceDraft) => {
          if (!win.isDestroyed()) {
            win.webContents.send(Channels.CONVERSATION_SOURCE_DRAFT, draft);
          }
        },
        onPropertyDraft: (draft: import('../shared/conversation-property-drafts').ConversationPropertyDraft) => {
          if (!win.isDestroyed()) {
            win.webContents.send(Channels.CONVERSATION_PROPERTY_DRAFT, draft);
          }
        },
        onComputeDraft: (draft: import('../shared/conversation-compute-drafts').ConversationComputeDraft) => {
          if (!win.isDestroyed()) {
            win.webContents.send(Channels.CONVERSATION_COMPUTE_DRAFT, draft);
          }
        },
        askUser: ({ question, choices }: { question: string; choices?: string[] }) => {
          const questionId = randomUUID();
          return new Promise<string>((resolve, reject) => {
            pendingAskUser.set(questionId, { winId: win.id, resolve, reject });
            if (!win.isDestroyed()) {
              win.webContents.send(Channels.CONVERSATION_ASK_USER, {
                questionId,
                conversationId: convId,
                question,
                choices,
              });
            } else {
              pendingAskUser.delete(questionId);
              reject(new Error('window destroyed'));
            }
          });
        },
        signal: controller.signal,
      };

      // Token the API's "container_id required" error to match against
      // its 400 message. Hoisted so the catch can string-match without
      // duplicating the phrase.
      const CONTAINER_REQUIRED_MARKER = 'container_id is required';
      // Strip assistant turns whose persisted text carries the
      // code_execution indicator markers we emit (`_🔍 Searching` /
      // `_🌐 Fetching` / `_⚙️ Running code`). Those messages are the
      // only ones whose presence in history can make the API demand a
      // container; once dropped, the API has nothing to "pend" on.
      // Lossy (the user loses the prior tool-result text in history),
      // but the alternative is a stuck conversation.
      const stripCodeExecutionTurns = (msgs: typeof messages) =>
        msgs.filter((m) => {
          if (m.role !== 'assistant' || typeof m.content !== 'string') return true;
          return !/_(?:🔍 Searching|🌐 Fetching|⚙️ Running code)/.test(m.content);
        });

      let result: Awaited<ReturnType<typeof completeWithTools>>;
      try {
        result = await completeWithTools({
          system: effectiveSystem,
          messages,
          toolContext: { rootPath, conversationId: convId },
          model: conv.model,
          extraTools,
          // Re-echo any prior turn's code-execution sandbox id. Required
          // by the API whenever the persisted message history still
          // contains a `server_tool_use` block; without it the next
          // turn rejects with "container_id is required when there are
          // pending tool uses generated by code execution with tools."
          ...(conv.containerId ? { initialContainerId: conv.containerId } : {}),
          callbacks: streamCallbacks,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes(CONTAINER_REQUIRED_MARKER)) throw err;
        // The API rejected because the persisted container id is
        // missing or stale and history still references code_execution.
        // Two common causes: the conversation predates container
        // persistence, or the container expired server-side. Drop the
        // cached id, strip the offending assistant turns from history,
        // and retry once. If it still fails, the original error
        // surfaces.
        console.warn(
          `[conv] container_id 400 — recovering. conv=${convId} ` +
          `cachedContainer=${conv.containerId ?? 'none'} stripping code_execution turns`,
        );
        await conversation.setContainerId(convId, undefined, undefined);
        const recoveredMessages = stripCodeExecutionTurns(messages);
        result = await completeWithTools({
          system: effectiveSystem,
          messages: recoveredMessages,
          toolContext: { rootPath, conversationId: convId },
          model: conv.model,
          extraTools,
          callbacks: streamCallbacks,
        });
      }

      const updated = await conversation.appendMessage(
        convId,
        'assistant',
        result.text,
        { citations: result.citations },
      );
      // Persist the (possibly updated) container id so the next turn
      // for this conversation can echo it. We write unconditionally
      // — even if the id is unchanged — because conversation.load /
      // appendMessage above don't preserve fields completeWithTools
      // can update mid-turn.
      if (result.containerId) {
        await conversation.setContainerId(
          convId,
          result.containerId,
          result.containerExpiresAt,
        );
      }
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

  // The user clicked Approve on a propose_notes draft card. We file the
  // bundle through the standard approval engine AND auto-approve it —
  // the user already reviewed the card, a second pending state in the
  // Proposals panel would be redundant. (See conversation-drafts.ts.)
  ipcMain.handle(
    Channels.CONVERSATION_FILE_DRAFT,
    async (e, draft: import('../shared/conversation-drafts').ConversationDraft) => {
      console.log('[conv] FILE_DRAFT received', {
        draftId: draft?.draftId,
        conversationId: draft?.conversationId,
        payloads: Array.isArray(draft?.payloads) ? draft.payloads.length : 'not-array',
      });
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      if (!draft || !Array.isArray(draft.payloads) || draft.payloads.length === 0) {
        throw new Error(
          `FILE_DRAFT: draft has no payloads (received ${JSON.stringify(draft).slice(0, 200)}). ` +
          `If this came from a Svelte 5 $state value, snapshot it before sending across IPC.`,
        );
      }
      const ctx = projectContext(rootPath);
      const proposal = await approval.proposeWrite(ctx, {
        operationType: 'component_creation',
        payloads: draft.payloads,
        note: draft.note,
        conversationUri: `https://minerva.dev/ontology/thought#conversation/${draft.conversationId}`,
        proposedBy: `llm:conversation:${draft.conversationId}`,
      });
      let filedPaths: string[] = [];
      if (proposal) {
        const result = await approval.approveProposal(ctx, proposal.uri);
        filedPaths = result.filedPaths;
      }
      return {
        proposalUri: proposal?.uri ?? null,
        applied: true,
        filedPaths,
      };
    },
  );

  // Counterpart to CONVERSATION_FILE_DRAFT for source-ingest drafts. The
  // user clicked Approve on a propose_sources inline card. We run the
  // existing ingestUrl / ingestIdentifier pipelines per source — same
  // path as the "Ingest URL…" / "Ingest Identifier…" menu items — so
  // LLM-driven and user-driven ingestion share Readability, site
  // handlers, Crossref/arXiv/PubMed lookup, and dedupe. Per-source
  // errors are non-fatal: one failing entry doesn't block the rest of
  // the bundle.
  ipcMain.handle(
    Channels.CONVERSATION_FILE_SOURCE_DRAFT,
    async (
      e,
      draft: import('../shared/conversation-source-drafts').ConversationSourceDraft,
    ): Promise<import('../shared/conversation-source-drafts').FileSourceDraftResult> => {
      console.log('[conv] FILE_SOURCE_DRAFT received', {
        draftId: draft?.draftId,
        conversationId: draft?.conversationId,
        sourceCount: Array.isArray(draft?.sources) ? draft.sources.length : 'not-array',
      });
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      if (!draft || !Array.isArray(draft.sources) || draft.sources.length === 0) {
        throw new Error(
          `FILE_SOURCE_DRAFT: draft has no sources (received ${JSON.stringify(draft).slice(0, 200)}). ` +
          `If this came from a Svelte 5 $state value, snapshot it before sending across IPC.`,
        );
      }
      const outcomes: import('../shared/conversation-source-drafts').SourceIngestOutcome[] = [];
      let anyIngested = false;
      for (const src of draft.sources) {
        try {
          if (src.identifier) {
            const result = await ingestIdentifier(rootPath, src.identifier, { fetchImpl: privilegedFetch });
            await reindexFile(rootPath, result.relativePath);
            outcomes.push({
              input: { identifier: src.identifier },
              sourceId: result.sourceId,
              title: result.title,
              duplicate: result.duplicate,
            });
            anyIngested = true;
          } else if (src.url) {
            const result = await ingestUrl(rootPath, src.url, { fetchImpl: privilegedFetch });
            await reindexFile(rootPath, result.relativePath);
            outcomes.push({
              input: { url: src.url },
              sourceId: result.sourceId,
              title: result.title,
              duplicate: result.duplicate,
            });
            anyIngested = true;
          } else {
            // Should not happen — propose_sources validates this — but
            // belt-and-suspenders so we don't crash the whole bundle on
            // a malformed entry that slipped through the IPC boundary.
            outcomes.push({
              input: src,
              error: 'Source entry has neither `identifier` nor `url`.',
            });
          }
        } catch (err) {
          console.warn(`[conv] FILE_SOURCE_DRAFT ingest failed for`, src, err);
          outcomes.push({
            input: src,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (anyIngested) {
        await persistIndexes(rootPath);
        const win = winFromEvent(e);
        if (!win.isDestroyed()) {
          win.webContents.send(Channels.SOURCES_CHANGED);
        }
      }
      return { outcomes };
    },
  );

  // Counterpart to CONVERSATION_FILE_DRAFT for set_properties bundles.
  // Reads each note, applies its frontmatter patch via
  // `patchFrontmatterProperties`, and writes the result back. Per-note
  // errors are non-fatal — the rest of the bundle still applies.
  ipcMain.handle(
    Channels.CONVERSATION_FILE_PROPERTY_DRAFT,
    async (
      e,
      draft: import('../shared/conversation-property-drafts').ConversationPropertyDraft,
    ): Promise<import('../shared/conversation-property-drafts').FilePropertyDraftResult> => {
      console.log('[conv] FILE_PROPERTY_DRAFT received', {
        draftId: draft?.draftId,
        conversationId: draft?.conversationId,
        updateCount: Array.isArray(draft?.updates) ? draft.updates.length : 'not-array',
        // Log the actual properties keys per update — the original
        // silent-failure bug was that this came across as an empty
        // object on every entry, producing no writes. Surface it so a
        // repeat of that hits a useful log line.
        updateKeys: Array.isArray(draft?.updates)
          ? draft.updates.map((u) => ({
              relativePath: u?.relativePath,
              keys: u?.properties ? Object.keys(u.properties) : null,
            }))
          : null,
      });
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      if (!draft || !Array.isArray(draft.updates) || draft.updates.length === 0) {
        throw new Error(
          `FILE_PROPERTY_DRAFT: draft has no updates (received ${JSON.stringify(draft).slice(0, 200)}). ` +
          `If this came from a Svelte 5 $state value, snapshot it before sending across IPC.`,
        );
      }
      const outcomes: import('../shared/conversation-property-drafts').PropertyUpdateOutcome[] = [];
      for (const u of draft.updates) {
        try {
          if (!u.properties || typeof u.properties !== 'object' || Object.keys(u.properties).length === 0) {
            // Don't silently produce a no-op outcome — that's what hid
            // the original cross-IPC serialization bug. Surface it as
            // an explicit error so the user sees something on the
            // Filed line and the log captures the bad payload.
            outcomes.push({
              relativePath: u.relativePath,
              changedKeys: [],
              deletedKeys: [],
              error: 'properties payload arrived empty across IPC — frontmatter not written.',
            });
            continue;
          }
          const before = await notebaseFs.readFile(rootPath, u.relativePath);
          const result = patchFrontmatterProperties(before, u.properties);
          if (result.changedKeys.length > 0) {
            // Route through the standard write pipeline rather than
            // bare `notebaseFs.writeFile`. Without this the file lands
            // on disk but the renderer's open editor + right-sidebar
            // Properties panel don't refresh until the note is closed
            // and reopened — the pipeline marks the watcher dedup,
            // reindexes the graph + search, AND emits the
            // NOTEBASE_REWRITTEN broadcast that triggers the in-place
            // reload. Same flow auto-tag/auto-link use after their
            // frontmatter mutations.
            await writeAndReindex(rootPath, u.relativePath, result.content, hooks);
          }
          outcomes.push({
            relativePath: u.relativePath,
            changedKeys: result.changedKeys,
            deletedKeys: result.deletedKeys,
          });
        } catch (err) {
          console.warn(`[conv] FILE_PROPERTY_DRAFT patch failed for`, u.relativePath, err);
          outcomes.push({
            relativePath: u.relativePath,
            changedKeys: [],
            deletedKeys: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // The graph indexer watches for file changes, so reindexing
      // happens automatically. We don't broadcast a separate event
      // here — the file watcher's NOTEBASE_FILE_CHANGED event is
      // what the renderer already listens for to refresh views.
      return { outcomes };
    },
  );

  // Counterpart for propose_compute draft cells (#245). The user
  // clicked Run; we execute via the compute registry, record the
  // ComputeProposal in the graph with thought:executed=true, and
  // append the result to the conversation log so the LLM's next
  // turn sees it as user-role context.
  ipcMain.handle(
    Channels.CONVERSATION_RUN_COMPUTE_DRAFT,
    async (
      e,
      input: import('../shared/conversation-compute-drafts').RunComputeDraftInput,
    ): Promise<import('../shared/conversation-compute-drafts').RunComputeDraftResult> => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      const { draft, editedCode } = input;
      if (!draft || !draft.language || !draft.code) {
        throw new Error('RUN_COMPUTE_DRAFT: draft is missing language or code.');
      }
      const codeToRun = editedCode ?? draft.code;
      console.log(`[conv] RUN_COMPUTE_DRAFT lang=${draft.language} draftId=${draft.draftId}`);
      const ctx = projectContext(rootPath);
      const result = await runComputeCell(draft.language, codeToRun, { rootPath });
      // Append the result to the conversation log as a user-role
      // message so the LLM's next turn sees it as context. Format
      // for legibility — the model parses these like any other
      // user input.
      const contextMessage = formatComputeResultAsContext(draft, codeToRun, result);
      try {
        await conversation.appendMessage(draft.conversationId, 'user', contextMessage);
      } catch (err) {
        console.warn('[conv] failed to append compute output to conversation:', err);
      }
      // Record the ComputeProposal in the graph (#245 acceptance
      // criterion: every executed cell has a matching record).
      try {
        recordComputeProposalRun(ctx, draft, codeToRun);
      } catch (err) {
        console.warn('[conv] failed to record ComputeProposal in graph:', err);
      }
      return { result };
    },
  );

  // Insert a compute-draft cell into a notebook with provenance
  // frontmatter (#245). Default destination is
  // `notes/inbox/conversations/<conversationId>.md`; the user can
  // override via the destinationPath argument.
  ipcMain.handle(
    Channels.CONVERSATION_INSERT_COMPUTE_DRAFT,
    async (
      e,
      input: import('../shared/conversation-compute-drafts').InsertComputeDraftInput,
    ): Promise<import('../shared/conversation-compute-drafts').InsertComputeDraftResult> => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      const { draft, editedCode, destinationPath } = input;
      if (!draft || !draft.language || !draft.code) {
        throw new Error('INSERT_COMPUTE_DRAFT: draft is missing language or code.');
      }
      const codeToInsert = editedCode ?? draft.code;
      const dest = destinationPath?.trim() || `notes/inbox/conversations/${draft.conversationId}.md`;
      // Read existing content (if any) so the cell appends rather
      // than overwrites. Missing-file is the common case for the
      // default destination — fall back to a fresh note.
      let existing: string;
      try {
        existing = await notebaseFs.readFile(rootPath, dest);
      } catch {
        existing = '';
      }
      const block = buildComputeProposalNoteBlock(draft, codeToInsert);
      const next = existing
        ? `${existing.replace(/\s*$/, '')}\n\n${block}\n`
        : `# Conversation: ${draft.conversationId}\n\n${block}\n`;
      await writeAndReindex(rootPath, dest, next, hooks);
      return { destinationPath: dest };
    },
  );

  ipcMain.handle(Channels.CONVERSATION_SET_MODEL, async (_e, convId: string, model: string | undefined) => {
    return conversation.setModel(convId, model);
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
