<script lang="ts">
  import type { NoteFile } from '../../../shared/types';
  import FileTree from './FileTree.svelte';
  import { api } from '../ipc/client';
  import { clampMenuToViewport } from '../utils/menuClamp';

  interface Props {
    files: NoteFile[];
    activeFilePath: string | null;
    depth?: number;
    canPaste?: boolean;
    /** Project-relative paths of every directory currently expanded.
     *  Single source of truth lives at Sidebar so multi-select can
     *  compute the visible-order list across the whole tree. */
    expanded: Record<string, boolean>;
    /** Selection set (relativePaths). Same lifecycle as `expanded`. */
    selection: ReadonlySet<string>;
    onToggleDir: (path: string) => void;
    /** Fired for any tree-item click. The handler decides plain-click
     *  semantics (open file, set selection) vs modifier semantics
     *  (toggle/range, no-open) based on the modifier flags. */
    onItemClick: (
      relativePath: string,
      isDirectory: boolean,
      mods: { shift: boolean; meta: boolean },
    ) => void;
    onNewNote: (directory: string) => void;
    onNewFolder: (directory: string) => void;
    onDelete: (relativePath: string, isDirectory: boolean) => void;
    onAddTag?: (relativePath: string, isDirectory: boolean) => void;
    onRemoveTag?: (relativePath: string, isDirectory: boolean) => void;
    /** Fired right before a tree-item context menu opens. Lets the
     *  parent promote the right-clicked item into the selection (Finder
     *  / VS Code: right-clicking outside the selection drops it to a
     *  single-item selection). The parent decides whether the click
     *  hit an existing selection or not. */
    onContextMenuTarget?: (relativePath: string) => void;
    onRename: (relativePath: string) => void;
    onCut: (relativePath: string, isDirectory: boolean) => void;
    onCopy: (relativePath: string, isDirectory: boolean) => void;
    onPaste: (destDirectory: string) => void;
    onMove: (srcPath: string, destDirectory: string) => void;
    onBookmark?: (relativePath: string) => void;
    onExternalDrop?: (destDirectory: string, files: FileList) => void;
  }

  let { files, activeFilePath, depth = 0, canPaste = false, expanded, selection, onToggleDir, onItemClick, onNewNote, onNewFolder, onDelete, onAddTag, onRemoveTag, onContextMenuTarget, onRename, onCut, onCopy, onPaste, onMove, onBookmark, onExternalDrop }: Props = $props();

  let contextMenu = $state<{ x: number; y: number; dir: string; target?: string; targetIsDir?: boolean } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();

  $effect(() => {
    if (!contextMenu || !contextMenuEl) return;
    const next = clampMenuToViewport(contextMenu.x, contextMenu.y, contextMenuEl);
    if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
      contextMenu = { ...contextMenu, ...next };
    }
  });
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
    // Critical: prevent the event from bubbling to the parent FileTree
    // (recursive case) and to Sidebar.svelte's `.file-list` root-drop
    // handler. Without this, a drop on a subfolder fires onMove twice —
    // once for the folder, then again for root with destDirectory='' —
    // and the two handleMove calls race against the same selection
    // snapshot. Net effect: some moved items land at root instead of
    // the dropped-on folder, and others ENOENT because an earlier
    // interleaved rename already moved them.
    e.stopPropagation();
    dropTarget = null;
    // External file drops (from Finder, Explorer, another app) arrive with a
    // populated `files` list; the internal-move drag sets `text/plain`
    // instead. Check files first so an OS drop never falls through to the
    // internal-move path.
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      onExternalDrop?.(destDir, files);
      return;
    }
    const srcPath = e.dataTransfer!.getData('text/plain');
    if (srcPath && srcPath !== destDir) {
      onMove(srcPath, destDir);
    }
  }

  // expanded is now lifted to Sidebar; we just dispatch upward.

  function handleContextMenu(e: MouseEvent, dirPath: string, target?: string, targetIsDir?: boolean) {
    e.preventDefault();
    e.stopPropagation();
    // Promote the right-clicked item into the selection BEFORE the
    // menu opens — actions read selection at click time, so the menu
    // and the action layer must agree on what's selected.
    if (target !== undefined) onContextMenuTarget?.(target);
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
          class:selected={selection.has(file.relativePath)}
          style:padding-left="{depth * 16 + 8}px"
          onclick={(e) => onItemClick(file.relativePath, true, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })}
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
            {expanded}
            {selection}
            {onToggleDir}
            {onItemClick}
            {onNewNote}
            {onNewFolder}
            {onDelete}
            {onAddTag}
            {onRemoveTag}
            {onContextMenuTarget}
            {onRename}
            {onCut}
            {onCopy}
            {onPaste}
            {onMove}
            {onBookmark}
            {onExternalDrop}
          />
        {/if}
      {:else}
        <button
          class="tree-item file"
          class:active={activeFilePath === file.relativePath}
          class:selected={selection.has(file.relativePath)}
          style:padding-left="{depth * 16 + 8}px"
          onclick={(e) => onItemClick(file.relativePath, false, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })}
          oncontextmenu={(e) => handleContextMenu(e, file.relativePath.includes('/') ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/')) : '', file.relativePath, false)}
          draggable={true}
          ondragstart={(e) => handleDragStart(e, file.relativePath)}
        >
          <span class="icon">📄</span>
          {file.name.replace(/\.(md|ttl|csv)$/, '')}
        </button>
      {/if}
    </li>
  {/each}
</ul>

{#if contextMenu}
  <div
    class="context-menu"
    bind:this={contextMenuEl}
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
      <button onclick={() => { void navigator.clipboard.writeText(contextMenu!.target!); contextMenu = null; }}>
        Copy Path
      </button>
      {#if !contextMenu.targetIsDir}
        <button onclick={() => { onBookmark?.(contextMenu!.target!); contextMenu = null; }}>Bookmark</button>
      {/if}
      <div class="submenu-item">
        <span class="submenu-trigger">Open In &#x25B8;</span>
        <div class="submenu">
          <button onclick={() => { void api.shell.revealFile(contextMenu!.target); contextMenu = null; }}>Reveal in Finder</button>
          <button onclick={() => { void api.shell.openInDefault(contextMenu!.target!); contextMenu = null; }}>Open in Default App</button>
          <button onclick={() => { void api.shell.openInTerminal(contextMenu!.target); contextMenu = null; }}>Open in Terminal</button>
        </div>
      </div>
      {#if onAddTag || onRemoveTag}
        <div class="separator"></div>
        {#if onAddTag}
          <button onclick={() => { onAddTag(contextMenu!.target!, contextMenu!.targetIsDir!); contextMenu = null; }}>
            Add Tag…
          </button>
        {/if}
        {#if onRemoveTag}
          <button onclick={() => { onRemoveTag(contextMenu!.target!, contextMenu!.targetIsDir!); contextMenu = null; }}>
            Remove Tag…
          </button>
        {/if}
      {/if}
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

  .tree-item.selected {
    background: var(--bg-button);
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .tree-item.selected.active {
    background: var(--bg-button-hover);
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
