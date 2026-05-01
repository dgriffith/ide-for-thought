<script lang="ts">
  import type { NoteFile } from '../../../shared/types';
  import FileTree from './FileTree.svelte';
  import TagPanel from './TagPanel.svelte';
  import SourcesPanel from './SourcesPanel.svelte';
  import TablesPanel from './TablesPanel.svelte';
  import { clampMenuToViewport } from '../utils/menuClamp';
  import { getSidebarSelectionStore } from '../stores/sidebar-selection.svelte';
  import { flattenVisible } from '../sidebar-tree-utils';
  import { tick } from 'svelte';

  type PanelType = 'notes' | 'sites' | 'tags' | 'tables';

  interface Props {
    files: NoteFile[];
    activeFilePath: string | null;
    onFileSelect: (relativePath: string, searchQuery?: string) => void;
    onNewNote: (directory: string) => void;
    onNewFolder: (directory: string) => void;
    onDelete: (relativePath: string, isDirectory: boolean) => void;
    onAddTag?: (relativePath: string, isDirectory: boolean) => void;
    onRemoveTag?: (relativePath: string, isDirectory: boolean) => void;
    onRename: (relativePath: string) => void;
    onCut: (relativePath: string, isDirectory: boolean) => void;
    onCopy: (relativePath: string, isDirectory: boolean) => void;
    onPaste: (destDirectory: string) => void;
    onMove: (srcPath: string, destDirectory: string) => void;
    onBookmark?: (relativePath: string) => void;
    onSourceSelect?: (sourceId: string) => void;
    onSourceDeleted?: (sourceId: string) => void;
    onShowConfirm?: (message: string, key: string, label?: string) => Promise<boolean>;
    onTableClick?: (tableName: string) => void;
    onOpenCsv?: (relativePath: string) => void;
    onExternalDrop?: (destDirectory: string, files: FileList) => void;
    canPaste?: boolean;
  }

  let { files, activeFilePath, onFileSelect, onNewNote, onNewFolder, onDelete, onAddTag, onRemoveTag, onRename, onCut, onCopy, onPaste, onMove, onBookmark, onSourceSelect, onSourceDeleted, onShowConfirm, onTableClick, onOpenCsv, onExternalDrop, canPaste = false }: Props = $props();
  let activePanel = $state<PanelType>('notes');
  let rootDropHover = $state(false);
  let tagPanel = $state<TagPanel>();
  let sourcesPanel = $state<SourcesPanel>();
  let tablesPanel = $state<TablesPanel>();
  let contextMenu = $state<{ x: number; y: number } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();

  // Lifted up from FileTree so multi-select can compute visible-order
  // ranges across the whole tree. Persists across re-renders within a
  // session; not saved to disk.
  let expanded = $state<Record<string, boolean>>({});
  const selectionStore = getSidebarSelectionStore();

  function toggleDir(path: string): void {
    expanded = { ...expanded, [path]: !expanded[path] };
  }

  /**
   * Look up a node by its relative path. Linear walk; the tree is
   * small enough (typical thoughtbase < 5k notes) that the `Map`
   * variant in `sidebar-tree-utils` would be over-engineering for
   * the keyboard-nav callsites that hit this once per arrow press.
   */
  function findNode(nodes: NoteFile[], path: string): NoteFile | null {
    for (const n of nodes) {
      if (n.relativePath === path) return n;
      if (n.children) {
        const hit = findNode(n.children, path);
        if (hit) return hit;
      }
    }
    return null;
  }

  /** Total visible rows in the file tree — denominator for the badge. */
  const totalVisible = $derived(flattenVisible(files, expanded).length);

  /**
   * Scroll the keyboard-focused row into view after an arrow press,
   * pinning to the nearest viewport edge so PageDown-style runs feel
   * smooth. Defers to the next microtask so the DOM has the new
   * `.kb-focused` class applied.
   */
  let fileListEl = $state<HTMLDivElement | undefined>();
  async function scrollFocusedIntoView(): Promise<void> {
    await tick();
    const path = selectionStore.focused;
    if (!path || !fileListEl) return;
    const escaped = (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(path) : path);
    const row = fileListEl.querySelector(`[data-relative-path="${escaped}"]`);
    if (row && row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /**
   * Plain click → set single selection AND open the file (the historical
   * behaviour everyone has muscle memory for).
   * ⌘/Ctrl click → toggle path in/out of selection, do NOT open.
   * Shift click → range from anchor to clicked path in visible order.
   * Folders behave the same except plain-click also toggles expand.
   */
  function handleItemClick(
    path: string,
    isDirectory: boolean,
    mods: { shift: boolean; meta: boolean },
  ): void {
    if (mods.shift) {
      selectionStore.selectRange(path, flattenVisible(files, expanded));
      return;
    }
    if (mods.meta) {
      selectionStore.toggle(path);
      return;
    }
    selectionStore.setSingle(path);
    if (isDirectory) {
      toggleDir(path);
    } else {
      onFileSelect(path);
    }
  }

  /** Ctrl/Cmd-A while focus is in the sidebar selects every visible row. */
  function handleKeyDown(e: KeyboardEvent): void {
    // Selection shortcuts only make sense on the Notes panel where the
    // file tree lives. On other tabs there's nothing to select.
    if (activePanel !== 'notes') return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      selectionStore.selectAll(flattenVisible(files, expanded));
      return;
    }
    if (e.key === 'Escape' && selectionStore.count > 0) {
      e.preventDefault();
      selectionStore.clear();
      return;
    }
  }

  /**
   * Keyboard navigation when the file-list itself has focus (#428).
   * Lives on the file-list element rather than `<svelte:window>` so
   * arrow keys in the editor don't accidentally drive the sidebar
   * cursor — the issue calls out "Tab or click the tree first" as
   * the explicit handoff.
   */
  function handleTreeKeyDown(e: KeyboardEvent): void {
    const visible = flattenVisible(files, expanded);
    // ⌘-↓/↑ on a focused folder: expand / collapse. Targets the
    // currently-focused row, not the next one. Fold the current row
    // open or shut without disturbing the cursor.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const cur = selectionStore.focused;
      if (!cur) return;
      const node = findNode(files, cur);
      if (!node?.isDirectory) return;
      e.preventDefault();
      const isExpanded = !!expanded[cur];
      if (e.key === 'ArrowDown' && !isExpanded) toggleDir(cur);
      if (e.key === 'ArrowUp' && isExpanded) toggleDir(cur);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = selectionStore.moveFocus(e.key === 'ArrowDown' ? 'down' : 'up', visible);
      if (next === null) return;
      if (e.shiftKey) {
        selectionStore.selectRange(next, visible);
      } else {
        selectionStore.setSingle(next);
        const node = findNode(files, next);
        if (node && !node.isDirectory) onFileSelect(next);
      }
      void scrollFocusedIntoView();
      return;
    }
    if (e.key === 'Enter') {
      const cur = selectionStore.focused;
      if (!cur) return;
      const node = findNode(files, cur);
      if (node && !node.isDirectory) {
        e.preventDefault();
        onFileSelect(cur);
      } else if (node?.isDirectory) {
        e.preventDefault();
        toggleDir(cur);
      }
      return;
    }
    if (e.key === ' ') {
      const cur = selectionStore.focused;
      if (!cur) return;
      e.preventDefault();
      selectionStore.toggle(cur);
    }
  }

  export function getSelectionPaths(): string[] {
    return selectionStore.paths();
  }
  export function clearSelection(): void {
    selectionStore.clear();
  }

  /**
   * Right-click on a tree row opens the context menu. If the row was
   * already part of the multi-selection, leave selection alone (so a
   * Delete/Format runs on the whole selection). If it wasn't, drop to
   * a single-item selection on the right-clicked row — matches Finder
   * and VS Code, and ensures the menu's Delete acts on the row the
   * user just clicked rather than a stale selection elsewhere.
   */
  function handleContextMenuTarget(path: string): void {
    if (!selectionStore.has(path)) selectionStore.setSingle(path);
  }

  $effect(() => {
    if (!contextMenu || !contextMenuEl) return;
    const next = clampMenuToViewport(contextMenu.x, contextMenu.y, contextMenuEl);
    if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
      contextMenu = { ...contextMenu, ...next };
    }
  });

  // Width is user-draggable, persisted to localStorage — matches the
  // right-sidebar pattern. Per-machine UI state, not worth IPC plumbing.
  const WIDTH_KEY = 'minerva.leftSidebarWidth';
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 600;
  const initialWidth = (() => {
    const v = parseInt(localStorage.getItem(WIDTH_KEY) ?? '', 10);
    if (Number.isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH) return v;
    return 250;
  })();
  let width = $state(initialWidth);
  let dragging = $state(false);

  function startResize(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (me: MouseEvent) => {
      // Drag handle is on the right edge; moving right grows, left shrinks.
      const next = startWidth + (me.clientX - startX);
      width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next));
    };
    const onUp = () => {
      dragging = false;
      localStorage.setItem(WIDTH_KEY, String(width));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleContextMenu(e: MouseEvent) {
    // Let FileTree's own context menu handle clicks on tree items
    const target = e.target as HTMLElement;
    if (target.closest('.tree-item')) return;
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY };
    const close = () => {
      contextMenu = null;
      window.removeEventListener('click', close);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  // Auto-switch to a panel when the host calls a refresh on it. Refresh
  // calls fired while a panel isn't mounted are no-ops; the panel
  // refetches its data on its next mount, so switching tabs always
  // shows the latest state.
  export function refreshTags() {
    tagPanel?.refresh();
  }

  export function refreshSources() {
    sourcesPanel?.refresh();
  }

  export function refreshTables() {
    tablesPanel?.refresh();
  }

  export function selectTag(tag: string) {
    activePanel = 'tags';
    // Wait for TagPanel to mount before driving it — bind:this resolves
    // after the {#if} switches the tab in.
    setTimeout(() => {
      tagPanel?.refresh();
      setTimeout(() => tagPanel?.selectTag(tag), 50);
    }, 0);
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<aside class="sidebar" style:width="{width}px">
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
  <div class="resize-handle" class:dragging onmousedown={startResize}></div>

  <div class="panel-tabs">
    <button
      class="panel-tab"
      class:active={activePanel === 'notes'}
      onclick={() => activePanel = 'notes'}
      title="Notes"
    >&#x25A4;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'sites'}
      onclick={() => activePanel = 'sites'}
      title="Sites"
    >&#x2761;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'tags'}
      onclick={() => activePanel = 'tags'}
      title="Tags"
    >#</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'tables'}
      onclick={() => activePanel = 'tables'}
      title="Tables"
    >&#x229E;</button>
  </div>

  <div class="panel-content">
    {#if activePanel === 'notes'}
      {#if files.length > 0}
        {#if selectionStore.count > 0}
          <div class="selection-badge">
            <span class="count">{selectionStore.count} of {totalVisible} selected</span>
            <button class="clear-btn" onclick={() => selectionStore.clear()}>clear</button>
          </div>
        {/if}
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->
        <div
          class="file-list"
          class:root-drop-hover={rootDropHover}
          tabindex="0"
          bind:this={fileListEl}
          onkeydown={handleTreeKeyDown}
          oncontextmenu={handleContextMenu}
          ondragover={(e) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; rootDropHover = true; }}
          ondragleave={(e) => { if (e.currentTarget === e.target) rootDropHover = false; }}
          ondrop={(e) => {
            e.preventDefault();
            rootDropHover = false;
            const dropped = e.dataTransfer?.files;
            if (dropped && dropped.length > 0) {
              onExternalDrop?.('', dropped);
              return;
            }
            const src = e.dataTransfer!.getData('text/plain');
            if (src) onMove(src, '');
          }}
        >
          <FileTree
            {files}
            {activeFilePath}
            {canPaste}
            {expanded}
            selection={selectionStore.selected}
            focusedPath={selectionStore.focused}
            onToggleDir={toggleDir}
            onItemClick={handleItemClick}
            {onNewNote}
            {onNewFolder}
            {onDelete}
            {onAddTag}
            {onRemoveTag}
            onContextMenuTarget={handleContextMenuTarget}
            {onRename}
            {onCut}
            {onCopy}
            {onPaste}
            {onMove}
            {onBookmark}
            {onExternalDrop}
          />
        </div>
      {:else}
        <div class="empty" oncontextmenu={handleContextMenu}>
          <p>No notes yet</p>
        </div>
      {/if}
    {:else if activePanel === 'sites'}
      {#if onSourceSelect && onShowConfirm}
        <SourcesPanel bind:this={sourcesPanel} {onSourceSelect} {onSourceDeleted} {onShowConfirm} />
      {/if}
    {:else if activePanel === 'tags'}
      <TagPanel bind:this={tagPanel} {onFileSelect} {onSourceSelect} />
    {:else if activePanel === 'tables'}
      {#if onTableClick && onOpenCsv}
        <TablesPanel bind:this={tablesPanel} {onTableClick} {onOpenCsv} />
      {/if}
    {/if}
  </div>

  {#if contextMenu}
    <div
      class="context-menu"
      bind:this={contextMenuEl}
      style:left="{contextMenu.x}px"
      style:top="{contextMenu.y}px"
    >
      <button onclick={() => { onNewNote(''); contextMenu = null; }}>
        New Note
      </button>
      <button onclick={() => { onNewFolder(''); contextMenu = null; }}>
        New Folder
      </button>
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    position: relative;
    min-width: 180px;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
  }
  .resize-handle:hover,
  .resize-handle.dragging {
    background: var(--accent);
    opacity: 0.3;
  }

  .panel-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: auto;
    scrollbar-width: thin;
  }
  .panel-tabs::-webkit-scrollbar {
    height: 6px;
  }
  .panel-tabs::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 3px;
  }

  .panel-tab {
    flex-shrink: 0;
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
  }

  .panel-tab:hover {
    background: var(--bg-button);
  }

  .panel-tab.active {
    background: var(--bg-button-hover);
    color: var(--text);
  }

  .panel-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .file-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    /* Make the tree focusable for keyboard nav (#428) — the focus ring
       hugs the file-list border rather than the default outline so it
       reads as "the tree is keyboard-armed" without being a thick blue
       glow inside the sidebar. */
    outline: none;
  }
  .file-list:focus-visible {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  /* Selection-count badge above the file tree (#428). */
  .selection-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-button);
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .selection-badge .count { flex: 1; }
  .selection-badge .clear-btn {
    border: none;
    background: none;
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
  }
  .selection-badge .clear-btn:hover { text-decoration: underline; }

  .file-list.root-drop-hover {
    outline: 1px dashed var(--accent);
    outline-offset: -2px;
  }

  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty p {
    color: var(--text-muted);
    font-size: 13px;
  }

  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 140px;
  }

  .context-menu button {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .context-menu button:hover {
    background: var(--bg-button);
  }
</style>
