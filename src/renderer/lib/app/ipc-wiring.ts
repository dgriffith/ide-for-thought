/**
 * Main↔renderer event wiring extracted from App.svelte (#1084). Registers every
 * `api.*.on*` subscription — the native-menu command bindings, the sources /
 * tables / embeddings / notebase-watcher / tools broadcasts, the bulk-import
 * progress streams, and the `project:opened` restore flow — plus the two
 * lifecycle hooks (`editor.onAutoSaved`, `beforeunload`), the notebase.open
 * refresh patch, and the skills-catalog load.
 *
 * Bodies are verbatim from App.svelte; the substitutions are mechanical:
 * singleton stores are pulled here (so all `editor.*` / `notebase.*` /
 * `bookmarkStore.*` / `busy.*` / `toolPanel.*` calls and `showConfirm` are
 * direct), while App-owned pieces — the ops handlers, the focused-pane editor
 * ref, the per-group editor map, the sidebar refs, and the UI-chrome `$state` —
 * arrive through `ctx`.
 *
 * IMPORTANT: unlike the typed CommandDeps / KeymapDeps tables (command-keymap.ts),
 * the `api.menu.on*` callbacks are untyped `() => void`, so a transposed binding
 * would be a silent runtime break. The paired table-driven test
 * (ipc-wiring.test.ts) captures every registration and asserts each dispatches
 * to the right action — that test IS the safety net here.
 *
 * Called once from App's onMount. The four subscriptions + the notebase.open
 * patch used to run at script-init; moving them to onMount is safe because main
 * only broadcasts them after a project is open (post-mount).
 */
import { tick } from 'svelte';
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { getEditorStore } from '../stores/editor.svelte';
import { getBusyStore } from '../stores/busy.svelte';
import { getToolPanelStore } from '../stores/tool-panel.svelte';
import { getConversationsStore } from '../stores/conversations.svelte';
import { getBookmarksStore } from '../stores/bookmarks.svelte';
import { getDialogStore } from '../stores/dialogs.svelte';
import { getToastStore } from '../stores/toasts.svelte';
import { maintenanceLabel, maintenanceOutcomeMessage } from '../../../shared/maintenance';
import { CONFIRM_KEYS } from '../confirm-keys';
import { loadFormatSettings } from '../formatter/settings';
import { registerSkillInfos } from '../tools/tool-registry';
import { applyMenuConfig } from '../../../shared/skills/menu-config';
import type { EditorView } from '@codemirror/view';
import type { ThemeMode } from '../theme';

/** Focused-pane editor methods the wiring drives (font, find, sort, and the
 *  beforeunload state capture). */
interface EditorRef {
  getOffset(): number;
  getView(): EditorView | undefined;
  changeFontSize(delta: number): void;
  currentFontSize(): number;
  resetFontSize(): void;
  runSortLines(): void;
  openFind(): void;
  openFindReplace(): void;
}

/** Sidebar panels refreshed on watcher / open events. */
interface SidebarRef {
  refreshTags(): void;
  refreshObjects?(): void;
  refreshSources(): void;
  refreshTables(): void;
}

export interface IpcWiringCtx {
  // Component refs (App-owned; resolve at callback time).
  getEditorComponent: () => EditorRef | undefined;
  getEditorComponents: () => Record<string, { restorePosition(offset: number, scrollTop?: number): void } | undefined>;
  /** Focused pane's preview, for the beforeunload scroll capture. Undefined
   *  when that pane isn't showing a preview. */
  getPreviewComponent: () => { currentScrollTop(): number } | undefined;
  getSidebar: () => SidebarRef | undefined;
  getRightSidebar: () => { refresh(): void } | undefined;

  // UI-chrome `$state` mutators.
  bumpGraphRevision: () => void;
  getEditorFontSize: () => number;
  setEditorFontSize: (n: number) => void;
  toggleSidebar: () => void;
  toggleRightSidebar: () => void;
  setShowGotoLine: (v: boolean) => void;
  setShowGotoNote: (v: boolean) => void;
  setShowEditSavedQueries: (v: boolean) => void;
  setShowAbout: (v: boolean) => void;
  setShowShortcuts: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setPublishDialogOpen: (v: boolean) => void;
  setFindInNotesMode: (m: 'find' | 'replace') => void;
  setExportDialogGroup: (g: string) => void;
  setEmbeddingProgress: (p: { done: number; total: number } | null) => void;

  // App-local refreshers (they write App `$state`, not store state). The two
  // awaited by the project-open flow return promises so that ordering is kept.
  refreshSourcesCache: () => Promise<void>;
  refreshAliasMap: () => Promise<void>;
  refreshSavedQueriesCache: () => void;
  refreshBacklinkCount: () => void;

  // Ops handlers + App-local flows (fire-and-forget; some return promises).
  newNote: () => void;
  editThoughtbaseGuide: () => void;
  openThoughtbaseProperties: () => void;
  save: () => void;
  saveAsTemplate: () => void;
  saveNoteAsObjectType: () => void;
  insertTemplate: () => void;
  cycleTheme: () => void;
  selectTheme: (mode: ThemeMode) => void;
  openThoughtbase: () => void;
  newThoughtbase: () => void;
  installTutorial: () => void;
  showProposals: () => void;
  openRecentThoughtbase: (rootPath: string) => void;
  navBack: () => void;
  navForward: () => void;
  rename: (path: string) => void;
  move: (path: string) => void;
  copy: (path: string) => void;
  extractSelection: () => void;
  splitHere: () => void;
  splitByHeading: () => void;
  autoTag: (path: string) => void;
  autoLink: (path: string) => void;
  autoLinkInbound: (path: string) => void;
  decompose: (path: string) => void;
  format: () => void;
  bibliography: () => void;
  ingestUrl: () => void;
  ingestIdentifier: () => void;
  ingestFile: () => void;
  importBibtex: () => void;
  importZoteroRdf: () => void;
  toolInvoke: (toolId: string) => void;
  newConversation: () => void;
  cycleViewMode: () => void;
  maybeShowOnboarding: () => Promise<void>;
  maybeOpenEntrypoints: () => Promise<void>;
}

export function registerAppIpc(ctx: IpcWiringCtx): void {
  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const busy = getBusyStore();
  const toolPanel = getToolPanelStore();
  const conversationsStore = getConversationsStore();
  const bookmarkStore = getBookmarksStore();
  const { showConfirm } = getDialogStore();

  // Pull skill metadata loaded by main (#625) into the renderer registry so
  // the tool panel / command palette / slash commands see skills alongside
  // hardcoded tools. Fire-and-forget — skills enrich the menus when ready.
  void (async () => {
    try {
      const cat = await api.skills.list();
      // Apply the per-machine menu config (#630): only enabled skills, in
      // their effective menu and configured order, reach the palette / slash.
      registerSkillInfos(applyMenuConfig(cat.skills, cat.config));
    } catch (err) {
      console.warn('[skills] failed to load skill list:', err);
    }
  })();

  // Auto-save
  editor.onAutoSaved = () => {
    ctx.getSidebar()?.refreshTags();
    ctx.getSidebar()?.refreshObjects?.();
    ctx.getRightSidebar()?.refresh();
    ctx.bumpGraphRevision();
    ctx.refreshBacklinkCount();
    void ctx.refreshAliasMap();
  };
  window.addEventListener('beforeunload', () => {
    // Capture current editor state before persisting — the Editor
    // only saves on unmount, which hasn't happened yet on window close
    const editorComponent = ctx.getEditorComponent();
    if (editor.activeFilePath && editorComponent) {
      editor.saveEditorState(
        editor.activeFilePath,
        editorComponent.getOffset(),
        editorComponent.getView()?.scrollDOM.scrollTop ?? 0,
      );
    }
    // Same for the preview pane, which saves on teardown that never comes here.
    const previewComponent = ctx.getPreviewComponent();
    if (editor.activeFilePath && previewComponent) {
      editor.savePreviewScroll(editor.activeFilePath, previewComponent.currentScrollTop());
    }
    editor.flushAutoSave();
    editor.persistTabs();
  });

  // Refresh tags when notebase opens
  const originalOpen = notebase.open;
  notebase.open = async () => {
    const result = await originalOpen();
    setTimeout(() => {
      ctx.getSidebar()?.refreshTags();
    ctx.getSidebar()?.refreshObjects?.();
      ctx.getSidebar()?.refreshSources();
      ctx.getSidebar()?.refreshTables();
      void ctx.refreshSourcesCache();
    }, 100);
    return result;
  };

  // Main broadcasts when the sources watcher reindexes or removes a source.
  // Refresh the sidebar Sources panel AND the editor autocomplete cache so
  // newly-ingested sources become reachable without a manual reload.
  api.sources.onChanged(() => {
    ctx.getSidebar()?.refreshSources();
    void ctx.refreshSourcesCache();
  });

  // Main broadcasts after the initial CSV scan and on every register/unregister
  // from the watcher — keeps the sidebar Tables panel in lockstep.
  api.tables.onChanged(() => {
    ctx.getSidebar()?.refreshTables();
  });

  // Semantic-index backfill progress (#836): a quiet status-bar indicator while
  // the corpus embeds in the background. Cleared on completion (running:false).
  api.embeddings.onBackfillProgress((p) => {
    ctx.setEmbeddingProgress(p.running && p.total > 0 ? { done: p.done, total: p.total } : null);
  });

  // File ▸ maintenance progress + completion (#1814). These run in main off the
  // native menu, so without this the user clicked "Rebuild All Indexes" and the
  // app looked identical before, during, and after — including when it failed.
  //
  // Nothing new on screen: a `blocking` task drives the same modal overlay the
  // bulk importers use (the graph really is half-built while it runs), a
  // `background` one stays out of the way, and every task ends with a toast —
  // the one moment a user needs telling, since the alternative is guessing
  // whether a silent app is working or finished.
  const toasts = getToastStore();
  api.maintenance.onProgress((p) => {
    if (p.running) {
      if (p.style === 'blocking') busy.setLabel(maintenanceLabel(p));
      return;
    }
    if (p.style === 'blocking') busy.setLabel(null);
    toasts.push({ message: maintenanceOutcomeMessage(p) });
  });

  // CSV table-name collision (#354): two CSVs would land on the
  // same DuckDB table name; the second was skipped. Show a
  // suppressible toast pointing at `table_name:` as the fix.
  api.tables.onNameCollision((collision) => {
    void showConfirm(
      `Two CSVs would use the same DuckDB table name "${collision.tableName}":\n\n` +
      `  • ${collision.existingPath}  (active)\n` +
      `  • ${collision.attemptedPath}  (skipped)\n\n` +
      `Add \`table_name: <unique-name>\` to a companion .md alongside one of them to disambiguate.`,
      CONFIRM_KEYS.tableNameCollision,
      'OK',
      { hideDontAskAgain: false },
    );
  });

  // Listen for menu events from main process
  api.menu.onNewNote(() => ctx.newNote());
  api.menu.onEditThoughtbaseDoc(() => { void ctx.editThoughtbaseGuide(); });
  api.menu.onThoughtbaseProperties(() => { ctx.openThoughtbaseProperties(); });
  api.menu.onSave(() => ctx.save());
  api.menu.onSaveAsTemplate(() => { void ctx.saveAsTemplate(); });
  api.menu.onSaveAsObjectType(() => { void ctx.saveNoteAsObjectType(); });
  api.menu.onInsertTemplate(() => { void ctx.insertTemplate(); });
  api.menu.onCycleTheme(() => ctx.cycleTheme());
  api.menu.onSetTheme((mode) => ctx.selectTheme(mode));
  api.menu.onFontIncrease(() => { const ec = ctx.getEditorComponent(); ec?.changeFontSize(1); ctx.setEditorFontSize(ec?.currentFontSize() ?? ctx.getEditorFontSize()); });
  api.menu.onFontDecrease(() => { const ec = ctx.getEditorComponent(); ec?.changeFontSize(-1); ctx.setEditorFontSize(ec?.currentFontSize() ?? ctx.getEditorFontSize()); });
  api.menu.onFontReset(() => { ctx.getEditorComponent()?.resetFontSize(); ctx.setEditorFontSize(14); });
  api.menu.onToggleSidebar(() => { ctx.toggleSidebar(); });
  api.menu.onToggleRightSidebar(() => { ctx.toggleRightSidebar(); });
  api.menu.onToggleConversations(() => conversationsStore.toggle());
  api.menu.onNewConversation(() => { void ctx.newConversation(); });
  api.menu.onTogglePreview(() => ctx.cycleViewMode());
  // Editor split — pane focus & layout commands (#814).
  api.menu.onSplitRight(() => editor.splitGroup(editor.activeGroupId, 'horizontal'));
  api.menu.onSplitDown(() => editor.splitGroup(editor.activeGroupId, 'vertical'));
  api.menu.onFocusNextGroup(() => editor.focusNextGroup());
  api.menu.onFocusPrevGroup(() => editor.focusPreviousGroup());
  api.menu.onCloseGroup(() => editor.closeActiveGroup());
  api.menu.onOpenProject(() => ctx.openThoughtbase());
  api.menu.onNewProject(() => ctx.newThoughtbase());
  api.menu.onInstallTutorial(() => ctx.installTutorial());
  // Native proposal-arrival notification clicked → surface the Proposals panel (#1541).
  api.proposals.onShowRequested(() => ctx.showProposals());
  api.menu.onOpenRecentProject((p) => ctx.openRecentThoughtbase(p));
  api.menu.onCloseProject(() => {
    notebase.close();
    editor.clear();
  });
  api.menu.onClearRecent(() => api.notebase.clearRecent());
  api.menu.onNavBack(() => ctx.navBack());
  api.menu.onNavForward(() => ctx.navForward());
  api.menu.onGotoLine(() => { if (editor.activeTab) ctx.setShowGotoLine(true); });
  api.menu.onQuickOpen(() => {
    // Lazily refresh the palette's source + query backing data so
    // its scope chip counts are fresh when the user opens it.
    void ctx.refreshSourcesCache();
    ctx.refreshSavedQueriesCache();
    ctx.setShowGotoNote(true);
  });
  api.menu.onNewQuery(() => editor.openQuery());
  api.menu.onOpenStockQuery(({ query, language }) => editor.openQuery(query, language));
  api.menu.onEditSavedQueries(() => { ctx.setShowEditSavedQueries(true); });
  api.menu.onSortLines(() => ctx.getEditorComponent()?.runSortLines());
  api.menu.onFind(() => ctx.getEditorComponent()?.openFind());
  api.menu.onFindReplace(() => ctx.getEditorComponent()?.openFindReplace());
  api.menu.onFindInNotes(() => { ctx.setFindInNotesMode('find'); });
  api.menu.onReplaceInNotes(() => { ctx.setFindInNotesMode('replace'); });
  api.menu.onPrint(() => window.print());
  api.menu.onAbout(() => { ctx.setShowAbout(true); });
  api.menu.onShortcuts(() => { ctx.setShowShortcuts(true); });
  api.menu.onOpenInDefault(() => { if (editor.activeFilePath) void api.shell.openInDefault(editor.activeFilePath); });
  api.menu.onOpenInTerminal(() => { void api.shell.openInTerminal(editor.activeFilePath ?? undefined); });
  api.menu.onOpenSettings(() => { ctx.setShowSettings(true); });

  // Refactor menu (issue #172)
  api.menu.onRefactorRename(() => { if (editor.activeFilePath) ctx.rename(editor.activeFilePath); });
  api.menu.onRefactorMove(() => { if (editor.activeFilePath) ctx.move(editor.activeFilePath); });
  api.menu.onRefactorCopy(() => { if (editor.activeFilePath) ctx.copy(editor.activeFilePath); });
  api.menu.onRefactorExtract(() => ctx.extractSelection());
  api.menu.onRefactorSplitHere(() => ctx.splitHere());
  api.menu.onRefactorSplitByHeading(() => ctx.splitByHeading());
  api.menu.onRefactorAutoTag(() => { if (editor.activeFilePath) ctx.autoTag(editor.activeFilePath); });
  api.menu.onRefactorAutoLink(() => { if (editor.activeFilePath) ctx.autoLink(editor.activeFilePath); });
  api.menu.onRefactorAutoLinkInbound(() => { if (editor.activeFilePath) ctx.autoLinkInbound(editor.activeFilePath); });
  api.menu.onRefactorDecompose(() => { if (editor.activeFilePath) ctx.decompose(editor.activeFilePath); });

  // Format menu (issue #153)
  api.menu.onFormat(() => ctx.format());

  // Insert/Update Bibliography (#113)
  api.menu.onBibliography(() => { void ctx.bibliography(); });

  // Ingest URL (#93)
  api.menu.onIngestUrl(() => ctx.ingestUrl());
  api.menu.onIngestIdentifier(() => ctx.ingestIdentifier());
  api.menu.onIngestFile(() => ctx.ingestFile());
  api.menu.onImportBibtex(() => ctx.importBibtex());
  api.menu.onImportZoteroRdf(() => ctx.importZoteroRdf());
  api.menu.onExport((groupId) => { ctx.setExportDialogGroup(groupId); });
  api.menu.onPublish(() => { ctx.setPublishDialogOpen(true); });

  // Progress updates during a bulk import — rewrites the busy-overlay
  // label in place so the user sees running counts on large imports.
  // One handler per stream; both funnel into the same busyLabel so the
  // user doesn't care which import is running.
  const progressToBusyLabel = ({ done, total, currentTitle }: { done: number; total: number; currentTitle: string }) => {
    if (busy.label) {
      const short = currentTitle.length > 60 ? currentTitle.slice(0, 57) + '…' : currentTitle;
      busy.setLabel(`Importing ${done}/${total}: ${short}`);
    }
  };
  api.sources.onImportBibtexProgress(progressToBusyLabel);
  api.sources.onImportZoteroRdfProgress(progressToBusyLabel);

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
  api.notebase.onFileDeleted((deletedPath) => {
    editor.closeTabsForDeletedPath(deletedPath);
    scheduleTreeRefresh();
  });

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
    // Keep the user's own section bookmarks pointing at the renamed
    // heading (#755). Local metadata, no content mutation — do it
    // unconditionally, even when nothing links to the heading.
    bookmarkStore.retargetSectionAnchor(candidate.relativePath, candidate.oldSlug, candidate.newSlug);
    // Only offer to rewrite OTHER notes' incoming links when some exist.
    const n = candidate.incomingLinkCount;
    if (n === 0) return;
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

  api.tools.onInvoke((toolId) => ctx.toolInvoke(toolId));

  api.menu.onProjectOpened(async (meta) => {
    await notebase.openPath(meta.rootPath);
    await editor.restoreTabs();
    await bookmarkStore.load();
    await loadFormatSettings();
    ctx.getSidebar()?.refreshTags();
    ctx.getSidebar()?.refreshObjects?.();
    ctx.getSidebar()?.refreshSources();
    ctx.getSidebar()?.refreshTables();
    await ctx.refreshSourcesCache();
    await ctx.refreshAliasMap();
    // The Inspections panel is re-enabled (#1446), but the status-bar count
    // badge stays un-polled for now (inspectionCount stays 0): the panel loads
    // its own results on demand, and periodic count polling is deferred with
    // the deterministic-fix work. Restore setInterval(refreshInspectionCount)
    // to re-light the badge.
    // Restore cursor/scroll for every pane's active note tab after the
    // split layout has rendered and each pane's Editor has mounted (#816 —
    // restore is now multi-group, not just the focused pane).
    await tick();
    requestAnimationFrame(() => {
      const editorComponents = ctx.getEditorComponents();
      for (const grp of editor.groups) {
        const noteTab = editor.noteTabForGroup(grp.id);
        if (noteTab?.cursorOffset != null) {
          editorComponents[grp.id]?.restorePosition(noteTab.cursorOffset, noteTab.scrollTop);
        }
      }
    });

    // Offer the onboarding journey on empty thoughtbases. Files have
    // already been loaded by `notebase.openPath` above, so the count
    // is current. Helper is shared with the in-window New/Open paths.
    await ctx.maybeShowOnboarding();
    // Auto-open any `entrypoint`-tagged notes when restoreTabs left
    // the editor with no note tabs. Runs after the onboarding check
    // because an empty thoughtbase has no entrypoints anyway, but
    // ordering doesn't matter beyond that.
    await ctx.maybeOpenEntrypoints();
  });
}
