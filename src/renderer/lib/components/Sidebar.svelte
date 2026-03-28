<script lang="ts">
  import type { NoteFile } from '../../../shared/types';
  import FileTree from './FileTree.svelte';

  interface Props {
    files: NoteFile[];
    activeFilePath: string | null;
    onFileSelect: (relativePath: string) => void;
    onOpenFolder: () => void;
  }

  let { files, activeFilePath, onFileSelect, onOpenFolder }: Props = $props();
</script>

<aside class="sidebar">
  <div class="sidebar-header">
    <button class="sidebar-btn" onclick={onOpenFolder} title="Open folder">
      Open Folder
    </button>
  </div>

  {#if files.length > 0}
    <div class="file-list">
      <FileTree {files} {activeFilePath} {onFileSelect} />
    </div>
  {:else}
    <div class="empty">
      <p>No notes yet</p>
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
</style>
