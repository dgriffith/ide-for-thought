<script lang="ts">
  import TitleBar from './lib/components/TitleBar.svelte';
  import TabBar from './lib/components/TabBar.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Editor from './lib/components/Editor.svelte';
  import QueryPanel from './lib/components/QueryPanel.svelte';
  import RightSidebar from './lib/components/RightSidebar.svelte';
  import StatusBar from './lib/components/StatusBar.svelte';
  import type { CursorInfo } from './lib/components/Editor.svelte';
  import Preview from './lib/components/Preview.svelte';
  import SourceDetail from './lib/components/SourceDetail.svelte';
  import { onMount, tick } from 'svelte';
  import { getNotebaseStore } from './lib/stores/notebase.svelte';
  import { getEditorStore } from './lib/stores/editor.svelte';
  import PromptDialog from './lib/components/PromptDialog.svelte';
  import ConfirmDialog from './lib/components/ConfirmDialog.svelte';
  import GotoLineDialog from './lib/components/GotoLineDialog.svelte';
  import GotoNoteDialog from './lib/components/GotoNoteDialog.svelte';
  import ToolPanel from './lib/components/ToolPanel.svelte';
  import ConversationDialog from './lib/components/ConversationDialog.svelte';
  import AutoLinkDialog from './lib/components/AutoLinkDialog.svelte';
  import AutoLinkInboundDialog from './lib/components/AutoLinkInboundDialog.svelte';
  import DecomposeDialog from './lib/components/DecomposeDialog.svelte';
  import BusyOverlay from './lib/components/BusyOverlay.svelte';
  import CsvTable from './lib/components/CsvTable.svelte';
  import type { AutoLinkSuggestion } from '../shared/refactor/auto-link';
  import type { AutoLinkInboundSuggestion } from '../shared/refactor/auto-link-inbound';
  import type { DecomposeProposal } from '../shared/refactor/decompose';
  import { planDecompose } from './lib/refactor/decompose-plan';
  import SettingsDialog from './lib/components/SettingsDialog.svelte';
  import { api } from './lib/ipc/client';
  import { getNavigationStore } from './lib/stores/navigation.svelte';
  import { initTheme, cycleTheme, getThemeMode } from './lib/theme';
  import { slugify } from '../shared/slug';
  import { initAppearance } from './lib/appearance/settings';
  import { getToolPanelStore } from './lib/stores/tool-panel.svelte';
  import { getConversationStore } from './lib/stores/conversation.svelte';
  import { getBookmarksStore } from './lib/stores/bookmarks.svelte';
  import { getConfirmSuppressionStore } from './lib/stores/confirm-suppression.svelte';
  import { CONFIRM_KEYS } from './lib/confirm-keys';
  import {
    planExtract,
    planSplitHere,
    deriveProposedTitle,
    todayDateString,
  } from './lib/refactor/extract';
  import { planSplitByHeading } from './lib/refactor/split-by-heading';
  import { getRefactorSettings } from './lib/refactor/settings';
  import { getFormatSettings, loadFormatSettings } from './lib/formatter/settings';
  import { toggleTaskOnLine } from './lib/editor/task-toggle';
  import { gatherContext } from './lib/tools/context';
  import { getAllToolInfos } from './lib/tools/tool-registry';
  import type { ContextBundle } from '../shared/types';
  import type { ToolContext } from '../shared/tools/types';

  type ViewMode = 'source' | 'preview' | 'split';

  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const nav = getNavigationStore();
  const toolPanel = getToolPanelStore();
  const convStore = getConversationStore();
  const bookmarkStore = getBookmarksStore();
  let showConversation = $state(false);
  /** When set, the next ConversationDialog mount auto-fires this message. Cleared after each open. */
  let pendingAutoMessage = $state<string | undefined>(undefined);
  let showSettings = $state(false);

  /** Pending Auto-link suggestions to review. Non-null means the AutoLinkDialog is shown. */
  let autoLinkReview = $state<{
    relativePath: string;
    suggestions: AutoLinkSuggestion[];
    activeBody: string;
  } | null>(null);
  /** Whether the Auto-link suggest request is currently in flight. Keeps the menu from re-triggering. */
  let autoLinkBusy = $state(false);
  /** When set, renders a modal spinner overlay with this label. */
  let busyLabel = $state<string | null>(null);

  /** Pending Auto-link inbound suggestions to review. Non-null = dialog is shown. */
  let autoLinkInboundReview = $state<{
    relativePath: string;
    suggestions: AutoLinkInboundSuggestion[];
  } | null>(null);

  /** Active Decompose Note preview. Non-null = dialog is shown. */
  let decomposeReview = $state<{
    relativePath: string;
    proposal: DecomposeProposal;
  } | null>(null);
  let inspectionCount = $state(0);

  async function refreshInspectionCount() {
    const results = await api.graph.inspections();
    inspectionCount = (results as unknown[]).length;
  }
  let viewMode = $state<ViewMode>('source');
  let sidebarVisible = $state(true);
  let sidebar = $state<Sidebar>();
  let rightSidebar = $state<RightSidebar>();
  let rightSidebarVisible = $state(false);
  let editorComponent = $state<Editor>();
  let queryPanelComponent = $state<QueryPanel>();
  let toolPanelComponent = $state<ToolPanel>();
  let cursorInfo = $state<CursorInfo>({ line: 1, column: 1, selectionLength: 0, wordCount: 0 });
  // Cache of every indexed source, refreshed on `sources:changed` and on
  // project open. Feeds the Editor's `[[cite::…]]` autocomplete so typing
  // in the editor doesn't have to await an IPC round-trip per keystroke.
  let sourcesCache = $state<import('../shared/types').SourceMetadata[]>([]);
  async function refreshSourcesCache(): Promise<void> {
    try { sourcesCache = await api.sources.listAll(); } catch { /* ignore */ }
  }
  let editorFontSize = $state(parseInt(localStorage.getItem('editorFontSize') ?? '14', 10));
  let themeLabel = $state(getThemeMode());
  let promptDialog = $state<{ message: string; resolve: (value: string | null) => void } | null>(null);
  let confirmDialog = $state<{ message: string; confirmLabel: string; key: string; resolve: (value: boolean) => void } | null>(null);
  const confirmSuppression = getConfirmSuppressionStore();

  function showPrompt(message: string): Promise<string | null> {
    return new Promise((resolve) => {
      promptDialog = { message, resolve };
    });
  }

  function showConfirm(message: string, key: string, confirmLabel = 'OK'): Promise<boolean> {
    if (confirmSuppression.isSuppressed(key)) return Promise.resolve(true);
    return new Promise((resolve) => {
      confirmDialog = { message, confirmLabel, key, resolve };
    });
  }

  function handlePromptConfirm(value: string) {
    promptDialog?.resolve(value);
    promptDialog = null;
  }

  function handlePromptCancel() {
    promptDialog?.resolve(null);
    promptDialog = null;
  }

  function handleConfirmOk(dontAskAgain: boolean) {
    if (dontAskAgain && confirmDialog) {
      confirmSuppression.suppress(confirmDialog.key);
    }
    confirmDialog?.resolve(true);
    confirmDialog = null;
  }

  function handleConfirmCancel() {
    confirmDialog?.resolve(false);
    confirmDialog = null;
  }

  let pendingSearchQuery = $state<string | null>(null);
  let showGotoLine = $state(false);
  let showGotoNote = $state(false);

  async function handleFileSelect(relativePath: string, searchQuery?: string) {
    recordCurrentPosition();
    const existingTab = editor.tabs.find((t) => t.type === 'note' && t.relativePath === relativePath) as import('./lib/stores/editor.svelte').NoteTab | undefined;
    const savedOffset = existingTab?.cursorOffset;
    const savedScroll = existingTab?.scrollTop;
    pendingSearchQuery = searchQuery ?? null;
    await editor.openFile(relativePath);
    if (!searchQuery && savedOffset != null) {
      await tick();
      requestAnimationFrame(() => {
        editorComponent?.restorePosition(savedOffset, savedScroll);
      });
      nav.record({ type: 'note', relativePath, offset: savedOffset });
    } else {
      nav.record({ type: 'note', relativePath, offset: 0 });
    }
  }

  let pendingPreviewAnchor = $state<string | null>(null);

  async function handleNavigate(target: string) {
    recordCurrentPosition();
    const hashIdx = target.indexOf('#');
    const pathPart = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
    const anchor = hashIdx >= 0 ? target.slice(hashIdx + 1) : null;
    const notePath = pathPart.endsWith('.md') ? pathPart : `${pathPart}.md`;
    await editor.openFile(notePath);
    // Route anchors: preview scrolls by element id; editor jumps by doc offset.
    if (anchor) {
      pendingPreviewAnchor = anchor;
      if (viewMode === 'source' || viewMode === 'split') {
        const content = editor.content;
        const offset = findAnchorOffset(content, anchor);
        if (offset !== null) {
          requestAnimationFrame(() => editorComponent?.gotoOffset(offset));
        }
      }
    }
    nav.record({ type: 'note', relativePath: notePath, offset: 0 });
  }

  /**
   * Locate a heading (by slug) or block-id inside raw markdown and return
   * the character offset of its line. Shared between source and split modes.
   */
  function findAnchorOffset(text: string, anchor: string): number | null {
    const isBlockId = anchor.startsWith('^');
    const lines = text.split('\n');
    let offset = 0;
    for (const line of lines) {
      if (isBlockId) {
        if (line.trimEnd().endsWith(anchor)) return offset;
      } else {
        const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (m && slugify(m[2]) === anchor) return offset;
      }
      offset += line.length + 1;
    }
    return null;
  }

  function handleOpenSource(sourceId: string, highlightExcerptId?: string) {
    recordCurrentPosition();
    editor.openSource(sourceId, { highlightExcerptId });
    nav.record({ type: 'source', sourceId, highlightExcerptId });
  }

  async function handleOpenExcerpt(excerptId: string) {
    const result = await api.graph.excerptSource(excerptId);
    if (!result) return;
    handleOpenSource(result.sourceId, excerptId);
  }

  /** Flatten the sidebar file tree to a list of indexable relative paths. */
  function flattenNotePaths(files: import('../shared/types').NoteFile[]): string[] {
    const out: string[] = [];
    const walk = (xs: import('../shared/types').NoteFile[]) => {
      for (const f of xs) {
        if (f.isDirectory) walk(f.children ?? []);
        else if (/\.(md|ttl|csv)$/.test(f.relativePath)) out.push(f.relativePath);
      }
    };
    walk(files);
    return out;
  }

  function handleTagSelect(tag: string) {
    sidebar?.refreshTags();
    setTimeout(() => sidebar?.selectTag(tag), 50);
  }

  function handleTaskToggle(lineIndex: number) {
    const current = editor.content;
    const next = toggleTaskOnLine(current, lineIndex);
    if (next !== current) editor.setContent(next);
  }

  async function handleSave() {
    if (editor.activeTab?.type === 'query') {
      await handleSaveQuery();
      return;
    }
    editor.flushAutoSave(); // cancel pending auto-save, save immediately
    sidebar?.refreshTags();
    rightSidebar?.refresh();
  }

  async function handleSaveQuery() {
    const tab = editor.activeQueryTab;
    if (!tab) return;
    const name = await showPrompt('Query name:');
    if (!name) return;
    await api.queries.save('project', name, '', tab.query);
    tab.title = name;
  }

  // ── Note refactoring: extract / split ──────────────────────────────────

  async function resolveTitle(body: string): Promise<string | null> {
    const derived = deriveProposedTitle(body);
    if (derived) return derived;
    return showPrompt('New note name:');
  }

  async function handleExtractSelection() {
    if (!notebase.meta) return;
    const tab = editor.activeNoteTab;
    if (!tab) return;
    const selection = editorComponent?.getSelectionRange();
    if (!selection) return;
    const selectedText = tab.content.slice(selection.from, selection.to);
    const title = await resolveTitle(selectedText);
    if (!title) return;

    editor.flushAutoSave();
    const plan = planExtract({
      sourceRelativePath: tab.relativePath,
      sourceContent: tab.content,
      selection,
      title,
      today: todayDateString(),
      settings: getRefactorSettings(),
    });

    await api.notebase.writeFile(plan.newNotePath, plan.newNoteContent);
    await api.notebase.writeFile(tab.relativePath, plan.updatedSourceContent);
    // The active tab still holds the pre-extract content in memory; reload
    // it from disk so the user sees the wiki-link and so the next auto-save
    // doesn't overwrite our rewrite.
    await editor.reloadTabFromDisk(tab.relativePath);
    await notebase.refresh();
    await editor.openFile(plan.newNotePath);
    sidebar?.refreshTags();
  }

  async function handleSplitByHeading() {
    if (!notebase.meta) return;
    const tab = editor.activeNoteTab;
    if (!tab) return;

    const answer = await showPrompt('Heading level to split on (1, 2, or 3):');
    if (!answer) return;
    const level = parseInt(answer.trim(), 10);
    if (level !== 1 && level !== 2 && level !== 3) return;

    editor.flushAutoSave();
    const plan = planSplitByHeading({
      sourceRelativePath: tab.relativePath,
      sourceContent: tab.content,
      level: level as 1 | 2 | 3,
      today: todayDateString(),
      settings: getRefactorSettings(),
    });

    if (plan.newNotes.length === 0) return;

    for (const note of plan.newNotes) {
      await api.notebase.writeFile(note.relativePath, note.content);
    }
    await api.notebase.writeFile(tab.relativePath, plan.updatedSourceContent);
    await editor.reloadTabFromDisk(tab.relativePath);
    await notebase.refresh();
    sidebar?.refreshTags();
  }

  async function handleSplitHere() {
    if (!notebase.meta) return;
    const tab = editor.activeNoteTab;
    if (!tab) return;
    const cursor = editorComponent?.getOffset() ?? 0;
    if (cursor >= tab.content.length) return;

    const tail = tab.content.slice(cursor);
    const title = await resolveTitle(tail);
    if (!title) return;

    editor.flushAutoSave();
    const plan = planSplitHere({
      sourceRelativePath: tab.relativePath,
      sourceContent: tab.content,
      cursor,
      title,
      today: todayDateString(),
      settings: getRefactorSettings(),
    });

    await api.notebase.writeFile(plan.newNotePath, plan.newNoteContent);
    await api.notebase.writeFile(tab.relativePath, plan.updatedSourceContent);
    await editor.reloadTabFromDisk(tab.relativePath);
    await notebase.refresh();
    await editor.openFile(plan.newNotePath);
    sidebar?.refreshTags();
  }

  async function handleNewNote(directory: string = '') {
    if (!notebase.meta) return;
    const name = await showPrompt('Note name:');
    if (!name) return;
    const filename = name.endsWith('.md') ? name : `${name}.md`;
    const relativePath = directory ? `${directory}/${filename}` : filename;
    await api.notebase.createFile(relativePath);
    await notebase.refresh();
    await editor.openFile(relativePath);
    sidebar?.refreshTags();
  }

  async function handleNewFolder(directory: string = '') {
    if (!notebase.meta) return;
    const name = await showPrompt('Folder name:');
    if (!name) return;
    const relativePath = directory ? `${directory}/${name}` : name;
    await api.notebase.createFolder(relativePath);
    await notebase.refresh();
  }

  async function handleDelete(relativePath: string, isDirectory: boolean) {
    if (!notebase.meta) return;
    const label = isDirectory ? 'folder' : 'note';
    const name = relativePath.split('/').pop();
    const confirmed = await showConfirm(`Delete ${label} "${name}"?`, CONFIRM_KEYS.delete, 'Delete');
    if (!confirmed) return;
    if (isDirectory) {
      await api.notebase.deleteFolder(relativePath);
    } else {
      await api.notebase.deleteFile(relativePath);
      const tabIdx = editor.tabs.findIndex((t) => t.relativePath === relativePath);
      if (tabIdx !== -1) editor.closeTab(tabIdx);
    }
    await notebase.refresh();
    sidebar?.refreshTags();
  }

  // ── Sidebar clipboard ──────────────────────────────────────────────────

  let clipboardItem = $state<{ relativePath: string; isDirectory: boolean; mode: 'cut' | 'copy' } | null>(null);

  function handleCut(relativePath: string, isDirectory: boolean) {
    clipboardItem = { relativePath, isDirectory, mode: 'cut' };
  }

  function handleCopy(relativePath: string, isDirectory: boolean) {
    clipboardItem = { relativePath, isDirectory, mode: 'copy' };
  }

  async function handleMove(srcPath: string, destDirectory: string) {
    if (!notebase.meta) return;
    const srcName = srcPath.split('/').pop()!;
    const destPath = destDirectory ? `${destDirectory}/${srcName}` : srcName;
    if (srcPath === destPath) return;
    await api.notebase.rename(srcPath, destPath);
    // Update open tab if the moved file was open
    const tabIdx = editor.tabs.findIndex((t) => t.type === 'note' && t.relativePath === srcPath);
    if (tabIdx !== -1) {
      const tab = editor.tabs[tabIdx] as any;
      tab.relativePath = destPath;
      tab.fileName = srcName;
    }
    await notebase.refresh();
  }

  async function handlePaste(destDirectory: string) {
    if (!clipboardItem || !notebase.meta) return;
    const srcName = clipboardItem.relativePath.split('/').pop()!;
    const destPath = destDirectory ? `${destDirectory}/${srcName}` : srcName;

    if (clipboardItem.mode === 'cut') {
      await api.notebase.rename(clipboardItem.relativePath, destPath);
      // If the moved file was open, update the tab
      const tabIdx = editor.tabs.findIndex((t) => t.type === 'note' && t.relativePath === clipboardItem!.relativePath);
      if (tabIdx !== -1) {
        const tab = editor.tabs[tabIdx] as any;
        tab.relativePath = destPath;
        tab.fileName = srcName;
      }
      clipboardItem = null;
    } else {
      await api.notebase.copy(clipboardItem.relativePath, destPath);
    }
    await notebase.refresh();
  }

  async function handleRename(relativePath: string) {
    if (!notebase.meta) return;
    const oldName = relativePath.split('/').pop()!;
    const rawNewName = await showPrompt('New name:');
    if (!rawNewName || rawNewName === oldName) return;
    // Preserve the old extension when the user didn't include one. A file
    // that drops its .md / .ttl suffix falls out of the indexed set and
    // effectively disappears from the sidebar; almost always a mistake.
    const oldDotIdx = oldName.lastIndexOf('.');
    const oldExt = oldDotIdx > 0 ? oldName.slice(oldDotIdx) : '';
    const newName = !rawNewName.includes('.') && oldExt ? `${rawNewName}${oldExt}` : rawNewName;
    const dir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
    const newPath = dir ? `${dir}/${newName}` : newName;
    // Tab path + content refresh is handled by the NOTEBASE_RENAMED /
    // NOTEBASE_REWRITTEN listeners registered in onMount — don't duplicate.
    await api.notebase.rename(relativePath, newPath);
    await notebase.refresh();
  }

  /**
   * Runs `fn` with the spinner overlay shown under `label`. Always clears
   * the overlay before returning — even on error — so that subsequent UI
   * (e.g. an error dialog) isn't trapped behind it.
   */
  async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
    busyLabel = label;
    try {
      return await fn();
    } finally {
      busyLabel = null;
    }
  }

  async function handleAutoLink(relativePath: string) {
    if (!notebase.meta || autoLinkBusy) return;
    autoLinkBusy = true;
    try {
      const { suggestions } = await withBusy('Auto-linking\u2026', () =>
        api.refactor.autoLinkSuggest(relativePath),
      );
      if (suggestions.length === 0) {
        await showConfirm(
          'Auto-link found no link candidates in this note.',
          CONFIRM_KEYS.autoLinkNoSuggestions,
          'OK',
        );
        return;
      }
      // Snapshot the current body (sans frontmatter) for context snippets in the dialog.
      const raw = await api.notebase.readFile(relativePath);
      const activeBody = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
      autoLinkReview = { relativePath, suggestions, activeBody };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-link failed: ${msg}`, CONFIRM_KEYS.autoLinkFailed, 'OK');
    } finally {
      autoLinkBusy = false;
    }
  }

  async function handleAutoLinkInbound(relativePath: string) {
    if (!notebase.meta || autoLinkBusy) return;
    autoLinkBusy = true;
    try {
      const { suggestions } = await withBusy('Scanning other notes\u2026', () =>
        api.refactor.autoLinkInboundSuggest(relativePath),
      );
      if (suggestions.length === 0) {
        await showConfirm(
          'Auto-link inbound found no places in other notes where a link here would fit.',
          CONFIRM_KEYS.autoLinkNoSuggestions,
          'OK',
        );
        return;
      }
      autoLinkInboundReview = { relativePath, suggestions };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-link failed: ${msg}`, CONFIRM_KEYS.autoLinkFailed, 'OK');
    } finally {
      autoLinkBusy = false;
    }
  }

  async function handleAutoLinkInboundApply(accepted: AutoLinkInboundSuggestion[]) {
    const review = autoLinkInboundReview;
    if (!review) return;
    autoLinkInboundReview = null;
    try {
      const plain = $state.snapshot(accepted) as AutoLinkInboundSuggestion[];
      const { applied, skipped } = await withBusy('Applying inbound links\u2026', () =>
        api.refactor.autoLinkInboundApply(review.relativePath, plain),
      );
      if (applied.length === 0 && skipped.length > 0) {
        await showConfirm(
          `Auto-link couldn\u2019t apply any suggestions \u2014 the anchor text changed in one or more source notes. Try again.`,
          CONFIRM_KEYS.autoLinkFailed,
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-link failed: ${msg}`, CONFIRM_KEYS.autoLinkFailed, 'OK');
    }
  }

  async function handleAutoLinkApply(accepted: AutoLinkSuggestion[]) {
    const review = autoLinkReview;
    if (!review) return;
    autoLinkReview = null;
    try {
      // Snapshot the suggestions before IPC — they came out of $state, which
      // wraps them in Svelte 5 proxies that structured-clone can't serialize.
      const plain = $state.snapshot(accepted) as AutoLinkSuggestion[];
      const { applied, skipped } = await withBusy('Applying links\u2026', () =>
        api.refactor.autoLinkApply(review.relativePath, plain),
      );
      if (applied.length === 0 && skipped.length > 0) {
        await showConfirm(
          `Auto-link couldn\u2019t apply any suggestions \u2014 the anchor text changed in the note. Try again.`,
          CONFIRM_KEYS.autoLinkFailed,
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-link failed: ${msg}`, CONFIRM_KEYS.autoLinkFailed, 'OK');
    }
  }

  async function handleFormatCurrentNote() {
    if (!notebase.meta) return;
    const tab = editor.activeNoteTab;
    if (!tab) return;
    const settings = getFormatSettings();
    try {
      const result = await withBusy('Formatting\u2026', () =>
        api.formatter.formatContent(tab.content, settings, tab.relativePath),
      );
      if (result !== tab.content) {
        editor.setContent(result);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Formatting failed: ${msg}`, CONFIRM_KEYS.formatFailed, 'OK');
    }
  }

  async function handleFormatFolder() {
    if (!notebase.meta) return;
    const raw = await showPrompt('Format every .md under folder (leave empty for root):');
    if (raw === null) return;
    const relDir = raw.trim().replace(/^\/+|\/+$/g, '');
    const settings = getFormatSettings();
    try {
      const summary = await withBusy('Formatting folder\u2026', () =>
        api.formatter.formatFolder(relDir, settings),
      );
      await showConfirm(
        `Formatting complete. Changed ${summary.changedPaths.length} of ${summary.totalScanned} file${summary.totalScanned === 1 ? '' : 's'}.`,
        CONFIRM_KEYS.formatComplete,
        'OK',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Formatting failed: ${msg}`, CONFIRM_KEYS.formatFailed, 'OK');
    }
  }

  async function handleFormatAll() {
    if (!notebase.meta) return;
    const ok = await showConfirm(
      'Format every note in the thoughtbase? Rewrites are applied in-place through the standard write pipeline.',
      CONFIRM_KEYS.formatAllConfirm,
      'Format all',
    );
    if (!ok) return;
    const settings = getFormatSettings();
    try {
      const summary = await withBusy('Formatting all notes\u2026', () =>
        api.formatter.formatFolder('', settings),
      );
      await showConfirm(
        `Formatting complete. Changed ${summary.changedPaths.length} of ${summary.totalScanned} file${summary.totalScanned === 1 ? '' : 's'}.`,
        CONFIRM_KEYS.formatComplete,
        'OK',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Formatting failed: ${msg}`, CONFIRM_KEYS.formatFailed, 'OK');
    }
  }

  async function handleIngestUrl() {
    if (!notebase.meta) return;
    const raw = await showPrompt('URL to ingest:');
    if (!raw) return;
    const url = raw.trim();
    if (!url) return;
    try {
      const result = await withBusy('Fetching…', () => api.sources.ingestUrl(url));
      // Wait a beat so the file watcher's indexSource pass finishes before
      // we try to open the source tab — otherwise the detail panel's graph
      // query returns empty and the tab renders as "unknown source."
      setTimeout(() => handleOpenSource(result.sourceId), 150);
      if (result.duplicate) {
        await showConfirm(
          `Already ingested: "${result.title || result.sourceId}". Opened the existing source.`,
          CONFIRM_KEYS.ingestDuplicate,
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Ingest failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleIngestIdentifier() {
    if (!notebase.meta) return;
    const raw = await showPrompt('DOI, arXiv id, or PubMed id:');
    if (!raw) return;
    const identifier = raw.trim();
    if (!identifier) return;
    try {
      const result = await withBusy('Looking up…', () => api.sources.ingestIdentifier(identifier));
      setTimeout(() => handleOpenSource(result.sourceId), 150);
      if (result.duplicate) {
        await showConfirm(
          `Already ingested: "${result.title || result.sourceId}". Opened the existing source.`,
          CONFIRM_KEYS.ingestDuplicate,
          'OK',
        );
      } else if (result.pdfError) {
        await showConfirm(
          `Ingested "${result.title}", but the open-access PDF fetch failed: ${result.pdfError}. The source's bibo:uri points at the canonical record so you can still grab it by hand.`,
          CONFIRM_KEYS.ingestPdfFailed,
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Ingest failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleDecompose(relativePath: string) {
    if (!notebase.meta) return;
    try {
      const { proposal, error } = await withBusy('Proposing a decomposition\u2026', () =>
        api.refactor.decomposeSuggest(relativePath),
      );
      if (!proposal) {
        await showConfirm(
          `The LLM returned an unusable decomposition${error ? ` (${error})` : ''}. Try again, or shorten the note first.`,
          CONFIRM_KEYS.decomposeBadProposal,
          'OK',
        );
        return;
      }
      decomposeReview = { relativePath, proposal };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Decompose failed: ${msg}`, CONFIRM_KEYS.decomposeFailed, 'OK');
    }
  }

  async function handleDecomposeRegenerate() {
    const review = decomposeReview;
    if (!review) return;
    try {
      const { proposal, error } = await withBusy('Regenerating decomposition\u2026', () =>
        api.refactor.decomposeSuggest(review.relativePath),
      );
      if (!proposal) {
        await showConfirm(
          `The LLM returned an unusable decomposition${error ? ` (${error})` : ''}. Keeping the previous proposal.`,
          CONFIRM_KEYS.decomposeBadProposal,
          'OK',
        );
        return;
      }
      decomposeReview = { relativePath: review.relativePath, proposal };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Decompose failed: ${msg}`, CONFIRM_KEYS.decomposeFailed, 'OK');
    }
  }

  async function handleDecomposeApply(edited: DecomposeProposal, include: boolean[]) {
    const review = decomposeReview;
    if (!review) return;
    const tab = editor.activeNoteTab;
    if (!tab || tab.relativePath !== review.relativePath) {
      decomposeReview = null;
      return;
    }

    decomposeReview = null;
    editor.flushAutoSave();

    // Snapshot across the Svelte 5 reactive boundary before use — the edited
    // proposal / include array came out of $state inside the dialog.
    const plainProposal = $state.snapshot(edited) as DecomposeProposal;
    const plainInclude = $state.snapshot(include) as boolean[];

    const plan = planDecompose({
      sourceRelativePath: tab.relativePath,
      sourceContent: tab.content,
      proposal: plainProposal,
      include: plainInclude,
      today: todayDateString(),
      settings: getRefactorSettings(),
    });

    if (plan.newNotes.length === 0) return;

    for (const note of plan.newNotes) {
      await api.notebase.writeFile(note.relativePath, note.content);
    }
    await api.notebase.writeFile(tab.relativePath, plan.updatedSourceContent);
    await editor.reloadTabFromDisk(tab.relativePath);
    await notebase.refresh();
    sidebar?.refreshTags();
  }

  async function handleAutoTag(relativePath: string) {
    if (!notebase.meta) return;
    try {
      const result = await withBusy('Auto-tagging\u2026', () =>
        api.refactor.autoTag(relativePath),
      );
      if (result.added.length === 0) {
        await showConfirm(
          'No new tags suggested. The note may be too short, too generic, or already well tagged.',
          CONFIRM_KEYS.autoTagNoSuggestions,
          'OK',
        );
      }
      // On success, the NOTEBASE_REWRITTEN listener reloads the note so the
      // user sees the new frontmatter tags appear in the editor.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-tag failed: ${msg}`, CONFIRM_KEYS.autoTagFailed, 'OK');
    }
  }

  async function handleMoveWithPrompt(relativePath: string) {
    if (!notebase.meta) return;
    const fileName = relativePath.split('/').pop()!;
    const currentDir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
    const raw = await showPrompt(`Move "${fileName}" to folder (leave empty for root):`);
    if (raw === null) return;
    const destDir = raw.trim().replace(/^\/+|\/+$/g, '');
    if (destDir === currentDir) return;
    const newPath = destDir ? `${destDir}/${fileName}` : fileName;

    let collision = false;
    try {
      await api.notebase.readFile(newPath);
      collision = true;
    } catch { /* expected: dest doesn't exist */ }
    if (collision) {
      await showConfirm(
        `A file already exists at "${newPath}". Move cancelled.`,
        CONFIRM_KEYS.moveCollision,
        'OK',
      );
      return;
    }

    await handleMove(relativePath, destDir);
  }

  function recordCurrentPosition() {
    const activeTab = editor.activeTab;
    if (!activeTab) return;
    if (activeTab.type === 'note' && editor.activeFilePath) {
      nav.record({ type: 'note', relativePath: editor.activeFilePath, offset: editorComponent?.getOffset() ?? 0 });
    } else if (activeTab.type === 'query') {
      nav.record({ type: 'query', tabId: activeTab.id });
    }
  }

  async function navigateToPosition(pos: import('./lib/stores/navigation.svelte').NavPosition) {
    if (pos.type === 'note') {
      await editor.openFile(pos.relativePath);
      requestAnimationFrame(() => {
        editorComponent?.gotoOffset(pos.offset);
        nav.doneNavigating();
      });
    } else if (pos.type === 'source') {
      editor.openSource(pos.sourceId, { highlightExcerptId: pos.highlightExcerptId });
      nav.doneNavigating();
    } else {
      const idx = editor.tabs.findIndex((t) => t.type === 'query' && t.id === pos.tabId);
      if (idx >= 0) {
        editor.switchTab(idx);
      }
      nav.doneNavigating();
    }
  }

  async function handleNavBack() {
    recordCurrentPosition();
    const pos = nav.goBack();
    if (!pos) return;
    await navigateToPosition(pos);
  }

  async function handleNavForward() {
    recordCurrentPosition();
    const pos = nav.goForward();
    if (!pos) return;
    await navigateToPosition(pos);
  }

  function handleCycleTheme() {
    themeLabel = cycleTheme();
    editorComponent?.updateTheme();
    queryPanelComponent?.updateTheme();
  }

  async function handleSwitchTab(index: number) {
    recordCurrentPosition();

    const targetTab = editor.tabs[index];
    const savedOffset = targetTab?.type === 'note' ? (targetTab as any).cursorOffset : undefined;
    const savedScroll = targetTab?.type === 'note' ? (targetTab as any).scrollTop : undefined;
    if (targetTab?.type === 'note') {
      await editor.openFile((targetTab as any).relativePath);
      if (savedOffset != null) {
        requestAnimationFrame(() => {
          editorComponent?.restorePosition(savedOffset, savedScroll);
        });
      }
      nav.record({ type: 'note', relativePath: (targetTab as any).relativePath, offset: savedOffset ?? 0 });
    } else if (targetTab?.type === 'query') {
      editor.switchTab(index);
      nav.record({ type: 'query', tabId: targetTab.id });
    } else {
      editor.switchTab(index);
    }
  }

  async function openConversationWithMessage(message: string) {
    await openConversation();
    // The conversation is now open; set the input to the message
    // The user can review and send it
  }

  async function openConversation() {
    const bundle: ContextBundle = {
      notePath: editor.activeFilePath ?? undefined,
      noteContent: editor.content || undefined,
      triggerNode: editor.activeFilePath ? {
        uri: editor.activeFilePath,
        type: 'minerva:Note',
        label: editor.activeFileName || editor.activeFilePath,
      } : undefined,
    };
    pendingAutoMessage = undefined;
    await convStore.start(bundle);
    showConversation = true;
  }

  async function handleOpenConversationFromTool(invocation: { toolId: string; context: ToolContext }) {
    let prep;
    try {
      prep = await api.tools.prepareConversation({
        toolId: invocation.toolId,
        context: invocation.context,
      });
    } catch (err) {
      console.error('[tool] prepareConversation failed:', err);
      return;
    }

    const ctx = invocation.context;
    const notePath = ctx.fullNotePath ?? editor.activeFilePath ?? undefined;
    const bundle: ContextBundle = {
      notePath,
      noteContent: ctx.fullNoteContent ?? (editor.content || undefined),
      triggerNode: notePath ? {
        uri: notePath,
        type: 'minerva:Note',
        label: ctx.fullNoteTitle ?? editor.activeFileName ?? notePath,
      } : undefined,
    };

    await convStore.start(bundle, undefined, {
      systemPrompt: prep.systemPrompt,
      ...(prep.model ? { model: prep.model } : {}),
    });

    pendingAutoMessage = prep.firstMessage || undefined;
    showConversation = true;
  }

  async function handleToolInvoke(toolId: string) {
    const allTools = getAllToolInfos();
    const toolInfo = allTools.find(t => t.id === toolId);
    if (!toolInfo) return;
    const ctx = await gatherContext(toolInfo.context, editorComponent?.getView());
    toolPanel.open(toolInfo, ctx);
    if (!toolInfo.parameters || toolInfo.parameters.length === 0) {
      requestAnimationFrame(() => toolPanelComponent?.startExecution());
    }
  }

  function handleRevealInSidebar(relativePath: string) {
    api.shell.revealFile(relativePath);
  }

  // Refresh tags when notebase opens
  const originalOpen = notebase.open;
  notebase.open = async () => {
    await originalOpen();
    setTimeout(() => {
      sidebar?.refreshTags();
      sidebar?.refreshSources();
      sidebar?.refreshTables();
      refreshSourcesCache();
    }, 100);
  };

  // Main broadcasts when the sources watcher reindexes or removes a source.
  // Refresh the sidebar Sources panel AND the editor autocomplete cache so
  // newly-ingested sources become reachable without a manual reload.
  api.sources.onChanged(() => {
    sidebar?.refreshSources();
    refreshSourcesCache();
  });

  // Main broadcasts after the initial CSV scan and on every register/unregister
  // from the watcher — keeps the sidebar Tables panel in lockstep.
  api.tables.onChanged(() => {
    sidebar?.refreshTables();
  });

  function cycleViewMode() {
    if (viewMode === 'source') viewMode = 'preview';
    else if (viewMode === 'preview') viewMode = 'split';
    else viewMode = 'source';
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === '[') {
      e.preventDefault();
      handleNavBack();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ']') {
      e.preventDefault();
      handleNavForward();
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
      e.preventDefault();
      cycleViewMode();
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'b') {
      e.preventDefault();
      rightSidebarVisible = !rightSidebarVisible;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
      e.preventDefault();
      handleCycleTheme();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      handleNewNote();
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'w') {
      if (editor.activeIndex >= 0) {
        e.preventDefault();
        editor.closeTab(editor.activeIndex);
      }
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'p') {
      if (notebase.meta) {
        e.preventDefault();
        showGotoNote = !showGotoNote;
      }
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'g') {
      if (editor.activeTab) {
        e.preventDefault();
        showGotoLine = true;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'q') {
      if (notebase.meta) {
        e.preventDefault();
        editor.openQuery();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'i') {
      e.preventDefault();
      if (showConversation) {
        showConversation = false;
      } else {
        openConversation();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
      e.preventDefault();
      if (!sidebarVisible) sidebarVisible = true;
      sidebar?.focusSearch();
    }
  }

  onMount(() => {
    initTheme();
    initAppearance();

    // Auto-save
    editor.onAutoSaved = () => {
      sidebar?.refreshTags();
      rightSidebar?.refresh();
    };
    window.addEventListener('beforeunload', () => {
      // Capture current editor state before persisting — the Editor
      // only saves on unmount, which hasn't happened yet on window close
      if (editor.activeFilePath && editorComponent) {
        editor.saveEditorState(
          editor.activeFilePath,
          editorComponent.getOffset(),
          editorComponent.getView()?.scrollDOM.scrollTop ?? 0,
        );
      }
      editor.flushAutoSave();
      editor.persistTabs();
    });

    // Listen for menu events from main process
    api.menu.onNewNote(() => handleNewNote());
    api.menu.onSave(() => handleSave());
    api.menu.onCycleTheme(() => handleCycleTheme());
    api.menu.onFontIncrease(() => { editorComponent?.changeFontSize(1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; });
    api.menu.onFontDecrease(() => { editorComponent?.changeFontSize(-1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; });
    api.menu.onFontReset(() => { editorComponent?.resetFontSize(); editorFontSize = 14; });
    api.menu.onToggleSidebar(() => { sidebarVisible = !sidebarVisible; });
    api.menu.onToggleRightSidebar(() => { rightSidebarVisible = !rightSidebarVisible; });
    api.menu.onTogglePreview(() => cycleViewMode());
    api.menu.onOpenProject(() => notebase.open());
    api.menu.onNewProject(() => notebase.newProject());
    api.menu.onOpenRecentProject((p) => notebase.openPath(p));
    api.menu.onCloseProject(() => {
      notebase.close();
      editor.clear();
    });
    api.menu.onClearRecent(() => api.notebase.clearRecent());
    api.menu.onNavBack(() => handleNavBack());
    api.menu.onNavForward(() => handleNavForward());
    api.menu.onGotoLine(() => { if (editor.activeTab) showGotoLine = true; });
    api.menu.onQuickOpen(() => { showGotoNote = true; });
    api.menu.onNewQuery(() => editor.openQuery());
    api.menu.onSaveQuery(() => handleSaveQuery());
    api.menu.onOpenStockQuery((q) => editor.openQuery(q));
    api.menu.onSortLines(() => editorComponent?.runSortLines());
    api.menu.onPrint(() => window.print());
    api.menu.onOpenInDefault(() => { if (editor.activeFilePath) api.shell.openInDefault(editor.activeFilePath); });
    api.menu.onOpenInTerminal(() => { api.shell.openInTerminal(editor.activeFilePath ?? undefined); });
    api.menu.onOpenSettings(() => { showSettings = true; });

    // Refactor menu (issue #172)
    api.menu.onRefactorRename(() => { if (editor.activeFilePath) handleRename(editor.activeFilePath); });
    api.menu.onRefactorMove(() => { if (editor.activeFilePath) handleMoveWithPrompt(editor.activeFilePath); });
    api.menu.onRefactorExtract(() => handleExtractSelection());
    api.menu.onRefactorSplitHere(() => handleSplitHere());
    api.menu.onRefactorSplitByHeading(() => handleSplitByHeading());
    api.menu.onRefactorAutoTag(() => { if (editor.activeFilePath) handleAutoTag(editor.activeFilePath); });
    api.menu.onRefactorAutoLink(() => { if (editor.activeFilePath) handleAutoLink(editor.activeFilePath); });
    api.menu.onRefactorAutoLinkInbound(() => { if (editor.activeFilePath) handleAutoLinkInbound(editor.activeFilePath); });
    api.menu.onRefactorDecompose(() => { if (editor.activeFilePath) handleDecompose(editor.activeFilePath); });

    // Format menu (issue #153)
    api.menu.onFormatCurrentNote(() => handleFormatCurrentNote());
    api.menu.onFormatFolder(() => handleFormatFolder());
    api.menu.onFormatAll(() => handleFormatAll());

    // Ingest URL (#93)
    api.menu.onIngestUrl(() => handleIngestUrl());
    api.menu.onIngestIdentifier(() => handleIngestIdentifier());

    // External file changes (watcher-driven) — refresh the sidebar so files
    // added / deleted in Finder show up without a restart. Debounced because
    // the watcher also fires for internal ops that already called refresh(),
    // and a burst of watcher events (e.g. ingesting a source tree) shouldn't
    // produce a burst of listFiles round-trips.
    let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleTreeRefresh = () => {
      if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
      treeRefreshTimer = setTimeout(() => {
        treeRefreshTimer = null;
        void notebase.refresh();
      }, 200);
    };
    api.notebase.onFileCreated(scheduleTreeRefresh);
    api.notebase.onFileDeleted(scheduleTreeRefresh);

    // Notebase rename/rewrite notifications from main — keep open tabs
    // consistent with disk so the next auto-save doesn't overwrite a
    // link rewrite silently.
    api.notebase.onRenamed((transitions) => {
      editor.applyRenameTransitions(transitions);
      bookmarkStore.applyRenameTransitions(transitions);
    });
    api.notebase.onRewritten(async (paths) => {
      for (const p of paths) {
        if (editor.isPathDirty(p)) {
          const keepDisk = await showConfirm(
            `"${p}" was updated on disk by a link rewrite. Discard your unsaved edits and load the new version?`,
            CONFIRM_KEYS.rewriteConflict,
            'Load disk',
          );
          if (!keepDisk) continue;
        }
        await editor.reloadTabFromDisk(p);
      }
    });

    api.notebase.onHeadingRenameSuggested(async (candidate) => {
      const n = candidate.incomingLinkCount;
      const msg =
        `The heading "${candidate.oldText}" in ${candidate.relativePath} looks like it was renamed ` +
        `to "${candidate.newText}". Update ${n} incoming link${n === 1 ? '' : 's'}?`;
      const ok = await showConfirm(msg, CONFIRM_KEYS.headingRenameSuggestion, 'Update links');
      if (!ok) return;
      await api.notebase.renameAnchor(candidate.relativePath, candidate.oldSlug, candidate.newSlug);
    });

    // Tools for Thought — stream listener (once)
    api.tools.onStream((chunk) => {
      toolPanel.appendChunk(chunk);
    });

    api.tools.onInvoke((toolId) => handleToolInvoke(toolId));

    api.menu.onProjectOpened(async (meta) => {
      await notebase.openPath(meta.rootPath);
      await editor.restoreTabs();
      await bookmarkStore.load();
      await loadFormatSettings();
      sidebar?.refreshTags();
      sidebar?.refreshSources();
      sidebar?.refreshTables();
      await refreshSourcesCache();
      // Load inspection count after a brief delay to let health checks finish
      setTimeout(refreshInspectionCount, 3000);
      // Refresh periodically
      setInterval(refreshInspectionCount, 60000);
      // Restore position for the active tab after tabs are rendered
      const activeTab = editor.activeNoteTab;
      if (activeTab?.cursorOffset != null) {
        await tick();
        requestAnimationFrame(() => {
          editorComponent?.restorePosition(activeTab.cursorOffset!, activeTab.scrollTop);
        });
      }
    });
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app">
  <TitleBar
    notebaseName={notebase.meta?.name ?? ''}
    fileName={editor.activeFileName}
    isDirty={editor.isDirty}
    canGoBack={nav.canGoBack}
    canGoForward={nav.canGoForward}
    onNavBack={handleNavBack}
    onNavForward={handleNavForward}
  />

  <div class="main">
    {#if notebase.meta}
      {#if sidebarVisible}
        <Sidebar
          bind:this={sidebar}
          files={notebase.files}
          activeFilePath={editor.activeFilePath}
          onFileSelect={handleFileSelect}
          onOpenFolder={notebase.open}
          onNewNote={handleNewNote}
          onNewFolder={handleNewFolder}
          onDelete={handleDelete}
          onRename={handleRename}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onMove={handleMove}
          onBookmark={(path) => bookmarkStore.add(path.split('/').pop()?.replace(/\.(md|ttl|csv)$/, '') ?? path, path)}
          onSourceSelect={(id) => handleOpenSource(id)}
          onTableClick={(name) => editor.openQuery(`SELECT * FROM ${name}`, 'sql')}
          onOpenCsv={(rel) => handleFileSelect(rel)}
          canPaste={clipboardItem !== null}
        />
      {/if}
      <div class="editor-pane">
        {#if editor.tabs.length > 0}
          <TabBar
            tabs={editor.tabs}
            activeIndex={editor.activeIndex}
            onSwitch={handleSwitchTab}
            onClose={editor.closeTab}
            onCloseOthers={editor.closeOthers}
            onCloseAll={editor.closeAll}
            onReveal={handleRevealInSidebar}
            onOpenConversation={openConversation}
            onBookmark={(path) => bookmarkStore.add(path.split('/').pop()?.replace(/\.(md|ttl|csv)$/, '') ?? path, path)}
          />
        {/if}
        {#if editor.activeTab?.type === 'note' && editor.activeTab.relativePath.endsWith('.csv')}
          <CsvTable
            relativePath={editor.activeTab.relativePath}
            content={editor.activeTab.content}
          />
        {:else if editor.activeTab?.type === 'note'}
          <div class="toolbar">
            <div class="view-toggle">
              <button
                class:active={viewMode === 'source'}
                onclick={() => viewMode = 'source'}
                title="Source (Cmd+Shift+P to cycle)"
              >Source</button>
              <button
                class:active={viewMode === 'split'}
                onclick={() => viewMode = 'split'}
                title="Split view"
              >Split</button>
              <button
                class:active={viewMode === 'preview'}
                onclick={() => viewMode = 'preview'}
                title="Preview"
              >Preview</button>
            </div>
            <button
              class="nav-btn sidebar-toggle"
              class:active={rightSidebarVisible}
              onclick={() => { rightSidebarVisible = !rightSidebarVisible; }}
              title="Toggle Right Sidebar (Cmd+Shift+B)"
            >&#x2759;</button>
          </div>
          <div class="editor-content" class:split={viewMode === 'split'}>
            {#if viewMode === 'source' || viewMode === 'split'}
              <div class="editor-panel">
                {#key editor.activeFilePath}
                  <Editor
                    bind:this={editorComponent}
                    filePath={editor.activeFilePath!}
                    content={editor.content}
                    initialHistory={editor.activeNoteTab?.historyJson}
                    searchQuery={pendingSearchQuery}
                    onContentChange={editor.setContent}
                    onSave={handleSave}
                    onSearchQueryConsumed={() => { pendingSearchQuery = null; }}
                    onEditorStateSave={editor.saveEditorState}
                    onCursorChange={(info) => { cursorInfo = info; }}
                    onToolInvoke={handleToolInvoke}
                    onOpenConversation={openConversation}
                    onNavigate={handleNavigate}
                    onOpenSource={handleOpenSource}
                    onOpenExcerpt={handleOpenExcerpt}
                    getNotePaths={() => flattenNotePaths(notebase.files)}
                    getSources={() => sourcesCache}
                    onBookmark={() => { if (editor.activeFilePath) bookmarkStore.add(editor.activeFileName.replace(/\.(md|ttl|csv)$/, ''), editor.activeFilePath, editorComponent?.getOffset()); }}
                    onExtractSelection={handleExtractSelection}
                    onSplitHere={handleSplitHere}
                    onSplitByHeading={handleSplitByHeading}
                    onRename={() => { if (editor.activeFilePath) handleRename(editor.activeFilePath); }}
                    onMove={() => { if (editor.activeFilePath) handleMoveWithPrompt(editor.activeFilePath); }}
                    onAutoTag={() => { if (editor.activeFilePath) handleAutoTag(editor.activeFilePath); }}
                    onAutoLink={() => { if (editor.activeFilePath) handleAutoLink(editor.activeFilePath); }}
                    onAutoLinkInbound={() => { if (editor.activeFilePath) handleAutoLinkInbound(editor.activeFilePath); }}
                    onDecompose={() => { if (editor.activeFilePath) handleDecompose(editor.activeFilePath); }}
                    onFormatCurrentNote={() => handleFormatCurrentNote()}
                    onInsertQueryList={async () => {
                      const tag = await showPrompt('Tag name:');
                      if (!tag) return;
                      const block = `\n:::query-list\nSELECT ?title ?path WHERE {\n  ?note minerva:hasTag ?t .\n  ?t minerva:tagName "${tag}" .\n  ?note dc:title ?title .\n  ?note minerva:relativePath ?path .\n} ORDER BY ?title\n:::\n`;
                      editorComponent?.insertText(block);
                    }}
                  />
                {/key}
              </div>
            {/if}
            {#if viewMode === 'preview' || viewMode === 'split'}
              <div class="preview-panel">
                <Preview
                  content={editor.content}
                  onNavigate={handleNavigate}
                  onTagSelect={handleTagSelect}
                  onOpenSource={handleOpenSource}
                  onOpenExcerpt={handleOpenExcerpt}
                  pendingAnchor={pendingPreviewAnchor}
                  onAnchorResolved={() => { pendingPreviewAnchor = null; }}
                  onTaskToggle={handleTaskToggle}
                />
              </div>
            {/if}
          </div>
          <StatusBar
            cursor={cursorInfo}
            fontSize={editorFontSize}
            theme={themeLabel}
            {inspectionCount}
            onGotoLine={() => { showGotoLine = true; }}
            onCycleTheme={handleCycleTheme}
            onShowInspections={() => { rightSidebarVisible = true; }}
          />
          <ToolPanel
            bind:this={toolPanelComponent}
            onNoteCreated={() => { notebase.refresh(); sidebar?.refreshTags(); }}
            onOpenConversation={handleOpenConversationFromTool}
          />
          {#if showConversation}
            <ConversationDialog
              onClose={() => { showConversation = false; }}
              onNavigate={handleNavigate}
              initialAutoMessage={pendingAutoMessage}
            />
          {/if}
        {:else if editor.activeTab?.type === 'query'}
          <QueryPanel
            bind:this={queryPanelComponent}
            tab={editor.activeQueryTab!}
            onQueryChange={editor.setQueryText}
            onLanguageChange={editor.setQueryLanguage}
            onExecute={editor.executeQuery}
            onSave={handleSaveQuery}
          />
          {#if showConversation}
            <ConversationDialog
              onClose={() => { showConversation = false; }}
              onNavigate={handleNavigate}
              initialAutoMessage={pendingAutoMessage}
            />
          {/if}
        {:else if editor.activeTab?.type === 'source'}
          {#key editor.activeTab.sourceId}
            <SourceDetail
              sourceId={editor.activeTab.sourceId}
              highlightExcerptId={editor.activeTab.highlightExcerptId}
              onNavigate={handleNavigate}
            />
          {/key}
        {:else}
          <div class="no-file">
            <p>Select a note from the sidebar</p>
          </div>
        {/if}
      </div>
      {#if rightSidebarVisible && editor.activeTab?.type === 'note'}
        <RightSidebar
          bind:this={rightSidebar}
          activeFilePath={editor.activeFilePath}
          content={editor.content}
          onFileSelect={handleFileSelect}
          onScrollToLine={(line) => editorComponent?.gotoLineColumn(line, 1)}
          onShowPrompt={showPrompt}
          onOpenConversation={(msg) => { openConversationWithMessage(msg); }}
        />
      {/if}
    {:else}
      <div class="welcome">
        <h1>Minerva</h1>
        <p>An experimental IDE for AI-assisted human thought.</p>
        <button onclick={notebase.open}>Open Thoughtbase</button>
      </div>
    {/if}
  </div>

  {#if showGotoNote}
    <GotoNoteDialog
      files={notebase.files}
      onSelect={(path) => { showGotoNote = false; handleFileSelect(path); }}
      onCancel={() => { showGotoNote = false; }}
    />
  {/if}
  {#if showGotoLine}
    {@const pos = editorComponent?.getCursorPosition() ?? { line: 1, column: 1 }}
    <GotoLineDialog
      currentLine={pos.line}
      currentColumn={pos.column}
      onGoto={(line, col) => {
        recordCurrentPosition();
        editorComponent?.gotoLineColumn(line, col);
        showGotoLine = false;
        if (editor.activeFilePath && editorComponent) {
          requestAnimationFrame(() => {
            nav.record({ type: 'note', relativePath: editor.activeFilePath!, offset: editorComponent!.getOffset() });
          });
        }
      }}
      onCancel={() => { showGotoLine = false; }}
    />
  {/if}
  {#if promptDialog}
    <PromptDialog
      message={promptDialog.message}
      onConfirm={handlePromptConfirm}
      onCancel={handlePromptCancel}
    />
  {/if}
  {#if confirmDialog}
    <ConfirmDialog
      message={confirmDialog.message}
      confirmLabel={confirmDialog.confirmLabel}
      onConfirm={handleConfirmOk}
      onCancel={handleConfirmCancel}
    />
  {/if}
  {#if autoLinkReview}
    <AutoLinkDialog
      suggestions={autoLinkReview.suggestions}
      activeNoteBody={autoLinkReview.activeBody}
      onApply={handleAutoLinkApply}
      onCancel={() => { autoLinkReview = null; }}
    />
  {/if}
  {#if autoLinkInboundReview}
    <AutoLinkInboundDialog
      suggestions={autoLinkInboundReview.suggestions}
      activeStem={autoLinkInboundReview.relativePath.replace(/\.md$/i, '')}
      onApply={handleAutoLinkInboundApply}
      onCancel={() => { autoLinkInboundReview = null; }}
    />
  {/if}
  {#if decomposeReview}
    <DecomposeDialog
      proposal={decomposeReview.proposal}
      onApply={handleDecomposeApply}
      onRegenerate={handleDecomposeRegenerate}
      onCancel={() => { decomposeReview = null; }}
    />
  {/if}
  {#if busyLabel}
    <BusyOverlay label={busyLabel} />
  {/if}
  {#if showSettings}
    <SettingsDialog
      onApplyEditor={(s) => editorComponent?.applySettings(s)}
      onThemeChanged={() => {
        themeLabel = getThemeMode();
        editorComponent?.updateTheme();
        queryPanelComponent?.updateTheme();
      }}
      onClose={() => { showSettings = false; }}
    />
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .editor-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
    background: var(--bg-toolbar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .sidebar-toggle {
    margin-left: auto;
  }

  .sidebar-toggle.active {
    color: var(--accent);
  }

  .view-toggle {
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .view-toggle button {
    padding: 3px 12px;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    border-right: 1px solid var(--border);
  }

  .view-toggle button:last-child {
    border-right: none;
  }

  .view-toggle button.active {
    background: var(--bg-button-hover);
    color: var(--text);
  }

  .view-toggle button:hover:not(.active) {
    background: var(--bg-button);
  }

  .editor-content {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .editor-content.split {
    gap: 1px;
    background: var(--border);
  }

  .editor-panel {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .preview-panel {
    flex: 1;
    display: flex;
    overflow: hidden;
    background: var(--bg);
  }

  .no-file {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .no-file p {
    color: var(--text-muted);
    font-size: 14px;
  }

  .welcome {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  .welcome h1 {
    font-size: 28px;
    font-weight: 300;
    color: var(--text);
  }

  .welcome p {
    color: var(--text-muted);
    font-size: 14px;
  }

  .welcome button {
    -webkit-app-region: no-drag;
    padding: 10px 24px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .welcome button:hover {
    background: var(--bg-button-hover);
  }
</style>
