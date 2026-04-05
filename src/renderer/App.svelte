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
  import { onMount, tick } from 'svelte';
  import { getNotebaseStore } from './lib/stores/notebase.svelte';
  import { getEditorStore } from './lib/stores/editor.svelte';
  import PromptDialog from './lib/components/PromptDialog.svelte';
  import ConfirmDialog from './lib/components/ConfirmDialog.svelte';
  import GotoLineDialog from './lib/components/GotoLineDialog.svelte';
  import GotoNoteDialog from './lib/components/GotoNoteDialog.svelte';
  import ToolPanel from './lib/components/ToolPanel.svelte';
  import ConversationDialog from './lib/components/ConversationDialog.svelte';
  import { api } from './lib/ipc/client';
  import { getNavigationStore } from './lib/stores/navigation.svelte';
  import { initTheme, cycleTheme, getThemeMode } from './lib/theme';
  import { getToolPanelStore } from './lib/stores/tool-panel.svelte';
  import { getConversationStore } from './lib/stores/conversation.svelte';
  import { getBookmarksStore } from './lib/stores/bookmarks.svelte';
  import { gatherContext } from './lib/tools/context';
  import { getAllToolInfos } from './lib/tools/tool-registry';
  import type { ContextBundle } from '../shared/types';

  type ViewMode = 'source' | 'preview' | 'split';

  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const nav = getNavigationStore();
  const toolPanel = getToolPanelStore();
  const convStore = getConversationStore();
  const bookmarkStore = getBookmarksStore();
  let showConversation = $state(false);
  let viewMode = $state<ViewMode>('source');
  let sidebarVisible = $state(true);
  let sidebar = $state<Sidebar>();
  let rightSidebar = $state<RightSidebar>();
  let rightSidebarVisible = $state(false);
  let editorComponent = $state<Editor>();
  let toolPanelComponent = $state<ToolPanel>();
  let cursorInfo = $state<CursorInfo>({ line: 1, column: 1, selectionLength: 0, wordCount: 0 });
  let editorFontSize = $state(parseInt(localStorage.getItem('editorFontSize') ?? '14', 10));
  let themeLabel = $state(getThemeMode());
  let promptDialog = $state<{ message: string; resolve: (value: string | null) => void } | null>(null);
  let confirmDialog = $state<{ message: string; confirmLabel: string; key: string; resolve: (value: boolean) => void } | null>(null);
  const suppressedConfirms = new Set<string>(
    JSON.parse(localStorage.getItem('suppressedConfirms') ?? '[]')
  );

  function showPrompt(message: string): Promise<string | null> {
    return new Promise((resolve) => {
      promptDialog = { message, resolve };
    });
  }

  function showConfirm(message: string, key: string, confirmLabel = 'OK'): Promise<boolean> {
    if (suppressedConfirms.has(key)) return Promise.resolve(true);
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
      suppressedConfirms.add(confirmDialog.key);
      localStorage.setItem('suppressedConfirms', JSON.stringify([...suppressedConfirms]));
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

  function handleNavigate(target: string) {
    recordCurrentPosition();
    const notePath = target.endsWith('.md') ? target : `${target}.md`;
    editor.openFile(notePath);
    nav.record({ type: 'note', relativePath: notePath, offset: 0 });
  }

  function handleTagSelect(tag: string) {
    sidebar?.refreshTags();
    setTimeout(() => sidebar?.selectTag(tag), 50);
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
    const confirmed = await showConfirm(`Delete ${label} "${name}"?`, 'confirm-delete', 'Delete');
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
    const newName = await showPrompt('New name:');
    if (!newName || newName === oldName) return;
    const dir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
    const newPath = dir ? `${dir}/${newName}` : newName;
    await api.notebase.rename(relativePath, newPath);
    // Update open tab if renamed
    const tabIdx = editor.tabs.findIndex((t) => t.type === 'note' && t.relativePath === relativePath);
    if (tabIdx !== -1) {
      const tab = editor.tabs[tabIdx] as any;
      tab.relativePath = newPath;
      tab.fileName = newName;
    }
    await notebase.refresh();
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
    await convStore.start(bundle, undefined, undefined);
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
    setTimeout(() => sidebar?.refreshTags(), 100);
  };

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

    // Tools for Thought — stream listener (once)
    api.tools.onStream((chunk) => {
      toolPanel.appendChunk(chunk);
    });

    api.tools.onInvoke((toolId) => handleToolInvoke(toolId));

    api.menu.onProjectOpened(async (meta) => {
      await notebase.openPath(meta.rootPath);
      await editor.restoreTabs();
      await bookmarkStore.load();
      sidebar?.refreshTags();
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
          onBookmark={(path) => bookmarkStore.add(path.split('/').pop()?.replace(/\.(md|ttl)$/, '') ?? path, path)}
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
            onBookmark={(path) => bookmarkStore.add(path.split('/').pop()?.replace(/\.(md|ttl)$/, '') ?? path, path)}
          />
        {/if}
        {#if editor.activeTab?.type === 'note'}
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
                    searchQuery={pendingSearchQuery}
                    onContentChange={editor.setContent}
                    onSave={handleSave}
                    onSearchQueryConsumed={() => { pendingSearchQuery = null; }}
                    onEditorStateSave={editor.saveEditorState}
                    onCursorChange={(info) => { cursorInfo = info; }}
                    onToolInvoke={handleToolInvoke}
                    onOpenConversation={openConversation}
                    onBookmark={() => { if (editor.activeFilePath) bookmarkStore.add(editor.activeFileName.replace(/\.(md|ttl)$/, ''), editor.activeFilePath, editorComponent?.getOffset()); }}
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
                />
              </div>
            {/if}
          </div>
          <StatusBar
            cursor={cursorInfo}
            fontSize={editorFontSize}
            theme={themeLabel}
            onGotoLine={() => { showGotoLine = true; }}
            onCycleTheme={handleCycleTheme}
          />
          <ToolPanel
            bind:this={toolPanelComponent}
            onNoteCreated={() => { notebase.refresh(); sidebar?.refreshTags(); }}
          />
          {#if showConversation}
            <ConversationDialog
              onClose={() => { showConversation = false; }}
              onNavigate={handleNavigate}
            />
          {/if}
        {:else if editor.activeTab?.type === 'query'}
          <QueryPanel
            tab={editor.activeQueryTab!}
            onQueryChange={editor.setQueryText}
            onExecute={editor.executeQuery}
            onSave={handleSaveQuery}
          />
          {#if showConversation}
            <ConversationDialog
              onClose={() => { showConversation = false; }}
              onNavigate={handleNavigate}
            />
          {/if}
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
