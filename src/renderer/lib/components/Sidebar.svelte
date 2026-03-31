<script lang="ts">
  import type { NoteFile } from '../../../shared/types';
  import FileTree from './FileTree.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import TagPanel from './TagPanel.svelte';

  interface Props {
    files: NoteFile[];
    activeFilePath: string | null;
    onFileSelect: (relativePath: string, searchQuery?: string) => void;
    onOpenFolder: () => void;
    onNewNote: (directory: string) => void;
    onNewFolder: (directory: string) => void;
    onDelete: (relativePath: string, isDirectory: boolean) => void;
    onRename: (relativePath: string) => void;
    onCut: (relativePath: string, isDirectory: boolean) => void;
    onCopy: (relativePath: string, isDirectory: boolean) => void;
    onPaste: (destDirectory: string) => void;
    onMove: (srcPath: string, destDirectory: string) => void;
    canPaste?: boolean;
  }

  let { files, activeFilePath, onFileSelect, onOpenFolder, onNewNote, onNewFolder, onDelete, onRename, onCut, onCopy, onPaste, onMove, canPaste = false }: Props = $props();
  let rootDropHover = $state(false);
  let tagPanel = $state<TagPanel>();
  let searchPanel = $state<SearchPanel>();
  let contextMenu = $state<{ x: number; y: number } | null>(null);

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

  export function focusSearch() {
    searchPanel?.focus();
  }

  export function selectTag(tag: string) {
    tagPanel?.refresh();
    setTimeout(() => tagPanel?.selectTag(tag), 50);
  }
</script>

<aside class="sidebar">
  <div class="sidebar-header">
    <button class="sidebar-btn" onclick={onOpenFolder} title="Open folder">
      Open Folder
    </button>
  </div>

  <SearchPanel bind:this={searchPanel} {onFileSelect} />

  {#if files.length > 0}
    <div
      class="file-list"
      class:root-drop-hover={rootDropHover}
      oncontextmenu={handleContextMenu}
      ondragover={(e) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; rootDropHover = true; }}
      ondragleave={(e) => { if (e.currentTarget === e.target) rootDropHover = false; }}
      ondrop={(e) => { e.preventDefault(); rootDropHover = false; const src = e.dataTransfer!.getData('text/plain'); if (src) onMove(src, ''); }}
    >
      <FileTree {files} {activeFilePath} {canPaste} {onFileSelect} {onNewNote} {onNewFolder} {onDelete} {onRename} {onCut} {onCopy} {onPaste} {onMove} />
    </div>
    <TagPanel bind:this={tagPanel} {onFileSelect} />
  {:else}
    <div class="empty" oncontextmenu={handleContextMenu}>
      <p>No notes yet</p>
    </div>
  {/if}
{#if contextMenu}
    <div
      class="context-menu"
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
    width: 250px;
    min-width: 180px;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    padding: 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .sidebar-btn {
    width: 100%;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }

  .sidebar-btn:hover {
    background: var(--bg-button-hover);
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
