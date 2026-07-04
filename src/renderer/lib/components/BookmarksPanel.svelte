<script lang="ts">
  import { getBookmarksStore } from '../stores/bookmarks.svelte';
  import type { BookmarkNode } from '../../../shared/types';
  import Ribbon from './right-sidebar/Ribbon.svelte';
  import Icon from './Icon.svelte';
  import { clampMenuToViewport } from '../utils/menuClamp';
  import { installDismissOnClickOutside } from '../dismiss-menu';

  interface Props {
    onFileSelect: (relativePath: string) => void;
    /** Open + scroll to an anchor (`path#slug`) for section bookmarks. */
    onNavigate?: (target: string) => void | Promise<void>;
    /** Open + jump to a character offset for line bookmarks (#756). */
    onOpenAtOffset?: (relativePath: string, offset: number) => void | Promise<void>;
    onShowPrompt: (message: string) => Promise<string | null>;
  }

  let { onFileSelect, onNavigate, onOpenAtOffset, onShowPrompt }: Props = $props();

  const bookmarks = getBookmarksStore();
  let expanded = $state<Record<string, boolean>>({});
  let search = $state('');
  let contextMenu = $state<{ x: number; y: number; nodeId: string; nodeType: 'bookmark' | 'folder' } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();

  $effect(() => {
    if (!contextMenu || !contextMenuEl) return;
    const next = clampMenuToViewport(contextMenu.x, contextMenu.y, contextMenuEl);
    if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
      contextMenu = { ...contextMenu, ...next };
    }
  });

  function collectFolderIds(nodes: BookmarkNode[], out: string[] = []): string[] {
    for (const n of nodes) {
      if (n.type === 'folder') {
        out.push(n.id);
        collectFolderIds(n.children, out);
      }
    }
    return out;
  }

  function expandAll() {
    const next: Record<string, boolean> = {};
    for (const id of collectFolderIds(bookmarks.tree)) next[id] = true;
    expanded = next;
  }

  function collapseAll() {
    expanded = {};
  }

  // When a search is active, hide branches whose entire subtree has no
  // matching bookmark. Folders whose name matches also stay visible even
  // if their children don't — lets the user find folders by name.
  function matchesSearch(node: BookmarkNode): boolean {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    if (node.name.toLowerCase().includes(q)) return true;
    if (node.type === 'folder') {
      return node.children.some(matchesSearch);
    }
    return false;
  }

  function toggleFolder(id: string) {
    expanded[id] = !expanded[id];
  }

  function handleClick(node: BookmarkNode) {
    if (node.type === 'bookmark') {
      if (node.anchor && onNavigate) void onNavigate(`${node.relativePath}#${node.anchor}`);
      else if (node.cursorOffset != null && onOpenAtOffset) void onOpenAtOffset(node.relativePath, node.cursorOffset);
      else onFileSelect(node.relativePath);
    } else {
      toggleFolder(node.id);
    }
  }

  /** Icon distinguishing the three bookmark kinds. */
  function bmIcon(node: { anchor?: string; cursorOffset?: number }): 'outline' | 'dot' | 'bookmark' {
    if (node.anchor) return 'outline';
    if (node.cursorOffset != null) return 'dot';
    return 'bookmark';
  }

  function showContextMenu(e: MouseEvent, node: BookmarkNode) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, nodeId: node.id, nodeType: node.type };
    installDismissOnClickOutside(() => { contextMenu = null; });
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
  <Ribbon
    {search}
    onSearch={(q: string) => { search = q; }}
    searchPlaceholder="Find bookmark…"
    onExpandAll={expandAll}
    onCollapseAll={collapseAll}
  />
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
        {#if matchesSearch(node)}
          {@render bookmarkNode(node, 0)}
        {/if}
      {/each}
    </div>
  {/if}

  {#if contextMenu}
    <div class="context-menu" bind:this={contextMenuEl} style:left="{contextMenu.x}px" style:top="{contextMenu.y}px">
      <button onclick={() => handleRename(contextMenu!.nodeId)}>Rename</button>
      <button onclick={() => { bookmarks.remove(contextMenu!.nodeId); contextMenu = null; }}>Delete</button>
    </div>
  {/if}
</div>

{#snippet bookmarkNode(node: BookmarkNode, depth: number)}
  {#if node.type === 'folder'}
    <div
      class="bm-item folder"
      style:padding-left="{8 + depth * 14}px"
      role="button"
      tabindex="0"
      onclick={() => toggleFolder(node.id)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFolder(node.id); } }}
      oncontextmenu={(e) => showContextMenu(e, node)}
      ondragover={handleDragOver}
      ondrop={(e) => { e.stopPropagation(); handleDrop(e, node.id); }}
    >
      <span class="chev"><Icon name={expanded[node.id] ? 'chevronDown' : 'chevronRight'} size={11} color="var(--text-faint)" /></span>
      <Icon name={expanded[node.id] ? 'folderOpen' : 'folder'} size={14} color="var(--text-muted)" />
      <span class="bm-name">{node.name}</span>
      <span class="folder-count">{node.children.length}</span>
    </div>
    {#if expanded[node.id] || search.trim()}
      {#each node.children as child}
        {#if matchesSearch(child)}
          {@render bookmarkNode(child, depth + 1)}
        {/if}
      {/each}
    {/if}
  {:else}
    <div
      class="bm-item bookmark"
      style:padding-left="{8 + depth * 14}px"
      role="button"
      tabindex="0"
      onclick={() => handleClick(node)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(node); } }}
      oncontextmenu={(e) => showContextMenu(e, node)}
      draggable={true}
      ondragstart={(e) => handleDragStart(e, node.id)}
    >
      <span class="chev"></span>
      <Icon name={bmIcon(node)} size={13} color="var(--text-faint)" />
      <span class="bm-body">
        <span class="bm-name">{node.name}</span>
        <span class="bm-path">{node.anchor ? `${node.relativePath} › §` : node.relativePath}</span>
      </span>
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
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .new-folder-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg);
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 11.5px;
    cursor: pointer;
  }

  .new-folder-btn:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }

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
    gap: 8px;
    padding: 5px 12px;
    border-left: 2px solid transparent;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 12.5px;
    color: var(--text);
  }
  .bm-item:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    border-left-color: var(--accent);
  }
  .bm-item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* Fixed-width chevron slot so folder/bookmark icons align in a column */
  .chev {
    width: 11px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .bm-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .bm-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Sub-line: source path in mono-faint (§13.7). Lives in the body
     column so it tucks under the bookmark name. */
  .bm-path {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Folder row: count chip on the right; folder title slightly heavier. */
  .folder {
    color: var(--text);
  }
  .folder .bm-name {
    font-weight: 500;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

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
