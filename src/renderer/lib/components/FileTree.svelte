<script lang="ts">
  import type { NoteFile } from '../../../shared/types';
  import FileTree from './FileTree.svelte';

  interface Props {
    files: NoteFile[];
    activeFilePath: string | null;
    depth?: number;
    canPaste?: boolean;
    onFileSelect: (relativePath: string) => void;
    onNewNote: (directory: string) => void;
    onNewFolder: (directory: string) => void;
    onDelete: (relativePath: string, isDirectory: boolean) => void;
    onRename: (relativePath: string) => void;
    onCut: (relativePath: string, isDirectory: boolean) => void;
    onCopy: (relativePath: string, isDirectory: boolean) => void;
    onPaste: (destDirectory: string) => void;
  }

  let { files, activeFilePath, depth = 0, canPaste = false, onFileSelect, onNewNote, onNewFolder, onDelete, onRename, onCut, onCopy, onPaste }: Props = $props();

  let expanded = $state<Record<string, boolean>>({});
  let contextMenu = $state<{ x: number; y: number; dir: string; target?: string; targetIsDir?: boolean } | null>(null);

  function toggleDir(path: string) {
    expanded[path] = !expanded[path];
  }

  function handleContextMenu(e: MouseEvent, dirPath: string, target?: string, targetIsDir?: boolean) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, dir: dirPath, target, targetIsDir };
    const close = () => {
      contextMenu = null;
      window.removeEventListener('click', close);
    };
    // Close on next click anywhere
    setTimeout(() => window.addEventListener('click', close), 0);
  }
</script>

<ul class="file-tree" style:--depth={depth}>
  {#each files as file}
    <li>
      {#if file.isDirectory}
        <button
          class="tree-item dir"
          style:padding-left="{depth * 16 + 8}px"
          onclick={() => toggleDir(file.relativePath)}
          oncontextmenu={(e) => handleContextMenu(e, file.relativePath, file.relativePath, true)}
        >
          <span class="icon">{expanded[file.relativePath] ? '▾' : '▸'}</span>
          {file.name}
        </button>
        {#if expanded[file.relativePath] && file.children}
          <FileTree
            files={file.children}
            {activeFilePath}
            depth={depth + 1}
            {canPaste}
            {onFileSelect}
            {onNewNote}
            {onNewFolder}
            {onDelete}
            {onRename}
            {onCut}
            {onCopy}
            {onPaste}
          />
        {/if}
      {:else}
        <button
          class="tree-item file"
          class:active={activeFilePath === file.relativePath}
          style:padding-left="{depth * 16 + 8}px"
          onclick={() => onFileSelect(file.relativePath)}
          oncontextmenu={(e) => handleContextMenu(e, file.relativePath.includes('/') ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/')) : '', file.relativePath, false)}
        >
          <span class="icon">📄</span>
          {file.name.replace(/\.md$/, '')}
        </button>
      {/if}
    </li>
  {/each}
</ul>

{#if contextMenu}
  <div
    class="context-menu"
    style:left="{contextMenu.x}px"
    style:top="{contextMenu.y}px"
  >
    {#if contextMenu.target}
      <button onclick={() => { onCut(contextMenu!.target!, contextMenu!.targetIsDir!); contextMenu = null; }}>
        Cut
      </button>
      <button onclick={() => { onCopy(contextMenu!.target!, contextMenu!.targetIsDir!); contextMenu = null; }}>
        Copy
      </button>
    {/if}
    {#if canPaste}
      <button onclick={() => { onPaste(contextMenu!.dir); contextMenu = null; }}>
        Paste
      </button>
    {/if}
    {#if contextMenu.target || canPaste}
      <div class="separator"></div>
    {/if}
    <button onclick={() => { onNewNote(contextMenu!.dir); contextMenu = null; }}>
      New Note Here
    </button>
    <button onclick={() => { onNewFolder(contextMenu!.dir); contextMenu = null; }}>
      New Folder
    </button>
    {#if contextMenu.target}
      <div class="separator"></div>
      <button onclick={() => { onRename(contextMenu!.target!); contextMenu = null; }}>
        Rename
      </button>
      <button onclick={() => { navigator.clipboard.writeText(contextMenu!.target!); contextMenu = null; }}>
        Copy Path
      </button>
      <div class="separator"></div>
      <button onclick={() => { onDelete(contextMenu!.target!, contextMenu!.targetIsDir!); contextMenu = null; }}>
        Delete
      </button>
    {/if}
  </div>
{/if}

<style>
  .file-tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    margin: 0;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    border-radius: 4px;
  }

  .tree-item:hover {
    background: var(--bg-button);
  }

  .tree-item.active {
    background: var(--bg-button-hover);
    color: var(--accent);
  }

  .icon {
    font-size: 11px;
    width: 14px;
    flex-shrink: 0;
    text-align: center;
  }

  .dir .icon {
    font-size: 12px;
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

  .separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
</style>
