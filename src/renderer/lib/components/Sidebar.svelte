<script lang="ts">
  import type { NoteFile } from '../../../shared/types';
  import FileTree from './FileTree.svelte';
  import TagPanel from './TagPanel.svelte';
  import SourcesPanel from './SourcesPanel.svelte';
  import TablesPanel from './TablesPanel.svelte';
  import { clampMenuToViewport } from '../utils/menuClamp';
  import { getSidebarSelectionStore } from '../stores/sidebar-selection.svelte';
  import { flattenVisible } from '../sidebar-tree-utils';

  interface Props {
    files: NoteFile[];
    activeFilePath: string | null;
    onFileSelect: (relativePath: string, searchQuery?: string) => void;
    onNewNote: (directory: string) => void;
    onNewFolder: (directory: string) => void;
    onDelete: (relativePath: string, isDirectory: boolean) => void;
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

  let { files, activeFilePath, onFileSelect, onNewNote, onNewFolder, onDelete, onRename, onCut, onCopy, onPaste, onMove, onBookmark, onSourceSelect, onSourceDeleted, onShowConfirm, onTableClick, onOpenCsv, onExternalDrop, canPaste = false }: Props = $props();
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

  export function getSelectionPaths(): string[] {
    return selectionStore.paths();
  }
  export function clearSelection(): void {
    selectionStore.clear();
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
    tagPanel?.refresh();
    setTimeout(() => tagPanel?.selectTag(tag), 50);
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<aside class="sidebar" style:width="{width}px">
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
  <div class="resize-handle" class:dragging onmousedown={startResize}></div>

  {#if files.length > 0}
    <div
      class="file-list"
      class:root-drop-hover={rootDropHover}
      oncontextmenu={handleContextMenu}
      ondragover={(e) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; rootDropHover = true; }}
      ondragleave={(e) => { if (e.currentTarget === e.target) rootDropHover = false; }}
      ondrop={(e) => {
        e.preventDefault();
        rootDropHover = false;
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          onExternalDrop?.('', files);
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
        onToggleDir={toggleDir}
        onItemClick={handleItemClick}
        {onNewNote}
        {onNewFolder}
        {onDelete}
        {onRename}
        {onCut}
        {onCopy}
        {onPaste}
        {onMove}
        {onBookmark}
        {onExternalDrop}
      />
    </div>
    <TagPanel bind:this={tagPanel} {onFileSelect} {onSourceSelect} />
    {#if onSourceSelect && onShowConfirm}
      <SourcesPanel bind:this={sourcesPanel} {onSourceSelect} {onSourceDeleted} {onShowConfirm} />
    {/if}
    {#if onTableClick && onOpenCsv}
      <TablesPanel bind:this={tablesPanel} {onTableClick} {onOpenCsv} />
    {/if}
  {:else}
    <div class="empty" oncontextmenu={handleContextMenu}>
      <p>No notes yet</p>
    </div>
  {/if}
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

  .file-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

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
