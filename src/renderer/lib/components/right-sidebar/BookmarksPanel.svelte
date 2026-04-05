<script lang="ts">
  import { getBookmarksStore } from '../../stores/bookmarks.svelte';
  import type { BookmarkNode } from '../../../../shared/types';

  interface Props {
    onFileSelect: (relativePath: string) => void;
    onShowPrompt: (message: string) => Promise<string | null>;
  }

  let { onFileSelect, onShowPrompt }: Props = $props();

  const bookmarks = getBookmarksStore();
  let expanded = $state<Record<string, boolean>>({});
  let contextMenu = $state<{ x: number; y: number; nodeId: string; nodeType: 'bookmark' | 'folder' } | null>(null);

  function toggleFolder(id: string) {
    expanded[id] = !expanded[id];
  }

  function handleClick(node: BookmarkNode) {
    if (node.type === 'bookmark') {
      onFileSelect(node.relativePath);
    } else {
      toggleFolder(node.id);
    }
  }

  function showContextMenu(e: MouseEvent, node: BookmarkNode) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, nodeId: node.id, nodeType: node.type };
    const close = () => { contextMenu = null; window.removeEventListener('click', close); };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  async function handleRename(id: string) {
    const name = await onShowPrompt('New name:');
    if (name) bookmarks.rename(id, name);
    contextMenu = null;
  }

  async function handleNewFolder() {
    const name = await onShowPrompt('Folder name:');
    if (name) bookmarks.addFolder(name);
  }

  function handleDragStart(e: DragEvent, id: string) {
    e.dataTransfer!.setData('text/bookmark-id', id);
    e.dataTransfer!.effectAllowed = 'move';
  }

  function handleDrop(e: DragEvent, targetFolderId: string | null) {
    e.preventDefault();
    const id = e.dataTransfer!.getData('text/bookmark-id');
    if (id && id !== targetFolderId) {
      bookmarks.move(id, targetFolderId);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  }
</script>

<div class="bookmarks-panel">
  <div class="panel-header">
    <button class="new-folder-btn" onclick={handleNewFolder} title="New Folder">+ Folder</button>
  </div>

  {#if bookmarks.tree.length === 0}
    <p class="empty">No bookmarks yet</p>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bookmark-tree"
      ondragover={handleDragOver}
      ondrop={(e) => handleDrop(e, null)}
    >
      {#each bookmarks.tree as node}
        {@render bookmarkNode(node, 0)}
      {/each}
    </div>
  {/if}

  {#if contextMenu}
    <div class="context-menu" style:left="{contextMenu.x}px" style:top="{contextMenu.y}px">
      <button onclick={() => handleRename(contextMenu!.nodeId)}>Rename</button>
      <button onclick={() => { bookmarks.remove(contextMenu!.nodeId); contextMenu = null; }}>Delete</button>
    </div>
  {/if}
</div>

{#snippet bookmarkNode(node: BookmarkNode, depth: number)}
  {#if node.type === 'folder'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bm-item folder"
      style:padding-left="{8 + depth * 14}px"
      onclick={() => toggleFolder(node.id)}
      oncontextmenu={(e) => showContextMenu(e, node)}
      ondragover={handleDragOver}
      ondrop={(e) => { e.stopPropagation(); handleDrop(e, node.id); }}
    >
      <span class="bm-icon">{expanded[node.id] ? '&#x25BE;' : '&#x25B8;'}</span>
      <span class="bm-name">{node.name}</span>
    </div>
    {#if expanded[node.id]}
      {#each node.children as child}
        {@render bookmarkNode(child, depth + 1)}
      {/each}
    {/if}
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bm-item bookmark"
      style:padding-left="{8 + depth * 14}px"
      onclick={() => handleClick(node)}
      oncontextmenu={(e) => showContextMenu(e, node)}
      draggable={true}
      ondragstart={(e) => handleDragStart(e, node.id)}
    >
      <span class="bm-icon">&#x2606;</span>
      <span class="bm-name">{node.name}</span>
    </div>
  {/if}
{/snippet}

<style>
  .bookmarks-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .new-folder-btn {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
  }

  .new-folder-btn:hover { background: var(--bg-button); color: var(--text); }

  .empty {
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
    padding: 16px 0;
  }

  .bookmark-tree {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .bm-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
    border-radius: 3px;
    margin: 0 4px;
  }

  .bm-item:hover { background: var(--bg-button); }

  .bm-icon {
    font-size: 11px;
    width: 12px;
    flex-shrink: 0;
    text-align: center;
    color: var(--text-muted);
  }

  .bm-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder .bm-name { font-weight: 500; }

  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 120px;
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

  .context-menu button:hover { background: var(--bg-button); }
</style>
