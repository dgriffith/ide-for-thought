<script lang="ts">
  import type { NoteFile } from '../../../shared/types';
  import FileTree from './FileTree.svelte';
  import { api } from '../ipc/client';

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
    onMove: (srcPath: string, destDirectory: string) => void;
    onBookmark?: (relativePath: string) => void;
  }

  let { files, activeFilePath, depth = 0, canPaste = false, onFileSelect, onNewNote, onNewFolder, onDelete, onRename, onCut, onCopy, onPaste, onMove, onBookmark }: Props = $props();

  let expanded = $state<Record<string, boolean>>({});
  let contextMenu = $state<{ x: number; y: number; dir: string; target?: string; targetIsDir?: boolean } | null>(null);
  let dropTarget = $state<string | null>(null);

  function handleDragStart(e: DragEvent, relativePath: string) {
    e.dataTransfer!.setData('text/plain', relativePath);
    e.dataTransfer!.effectAllowed = 'move';
  }

  function handleDragOver(e: DragEvent, dirPath: string) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dropTarget = dirPath;
  }

  function handleDragLeave() {
    dropTarget = null;
  }

  function handleDrop(e: DragEvent, destDir: string) {
    e.preventDefault();
    dropTarget = null;
    const srcPath = e.dataTransfer!.getData('text/plain');
    if (srcPath && srcPath !== destDir) {
      onMove(srcPath, destDir);
    }
  }

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
          class:drop-hover={dropTarget === file.relativePath}
          style:padding-left="{depth * 16 + 8}px"
          onclick={() => toggleDir(file.relativePath)}
          oncontextmenu={(e) => handleContextMenu(e, file.relativePath, file.relativePath, true)}
          draggable={true}
          ondragstart={(e) => handleDragStart(e, file.relativePath)}
          ondragover={(e) => handleDragOver(e, file.relativePath)}
          ondragleave={handleDragLeave}
          ondrop={(e) => handleDrop(e, file.relativePath)}
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
            {onMove}
          />
        {/if}
      {:else}
        <button
          class="tree-item file"
          class:active={activeFilePath === file.relativePath}
          style:padding-left="{depth * 16 + 8}px"
          onclick={() => onFileSelect(file.relativePath)}
          oncontextmenu={(e) => handleContextMenu(e, file.relativePath.includes('/') ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/')) : '', file.relativePath, false)}
          draggable={true}
          ondragstart={(e) => handleDragStart(e, file.relativePath)}
        >
          <span class="icon">📄</span>
          {file.name.replace(/\.(md|ttl)$/, '')}
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
      {#if !contextMenu.targetIsDir}
        <button onclick={() => { onBookmark?.(contextMenu!.target!); contextMenu = null; }}>Bookmark</button>
      {/if}
      <div class="submenu-item">
        <span class="submenu-trigger">Open In &#x25B8;</span>
        <div class="submenu">
          <button onclick={() => { api.shell.revealFile(contextMenu!.target!); contextMenu = null; }}>Reveal in Finder</button>
          <button onclick={() => { api.shell.openInDefault(contextMenu!.target!); contextMenu = null; }}>Open in Default App</button>
          <button onclick={() => { api.shell.openInTerminal(contextMenu!.target!); contextMenu = null; }}>Open in Terminal</button>
        </div>
      </div>
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

  .tree-item.drop-hover {
    background: var(--bg-button-hover);
    outline: 1px dashed var(--accent);
    outline-offset: -1px;
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

  .submenu-item {
    position: relative;
  }

  .submenu-trigger {
    display: block;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text);
    cursor: default;
  }

  .submenu-trigger:hover {
    background: var(--bg-button);
  }

  .submenu {
    display: none;
    position: absolute;
    left: 100%;
    top: 0;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 160px;
  }

  .submenu-item:hover .submenu {
    display: block;
  }
</style>
