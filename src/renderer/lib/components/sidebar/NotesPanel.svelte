<script lang="ts">
  /**
   * The Notes panel (#2626): the thoughtbase's file tree — multi-select,
   * keyboard navigation (#428), auto-reveal of the active note (#460), folder
   * drag-and-drop, the project root's own row and menu. Extracted from
   * `Sidebar.svelte`, which now draws whichever panel the left-sidebar
   * registry (`sidebar/panels.ts`) says is active.
   *
   * Mounted only while it's the active panel: the tree's open folders live in
   * `stores/notes-tree.svelte.ts` so they survive switching away and back, and
   * mounting reveals the active note, as switching back to Notes always did.
   */
  import type { NoteFile } from '../../../../shared/types';
  import FileTree from '../FileTree.svelte';
  import NotesRootMenu from '../NotesRootMenu.svelte';
  import Icon from '../Icon.svelte';
  import { clampMenuToViewport } from '../../utils/menuClamp';
  import { installDismissOnClickOutside } from '../../dismiss-menu';
  import { getSidebarSelectionStore } from '../../stores/sidebar-selection.svelte';
  import { getNotebaseStore } from '../../stores/notebase.svelte';
  import { getEditorStore } from '../../stores/editor.svelte';
  import { getClipboardStore } from '../../stores/clipboard.svelte';
  import { getBookmarksStore } from '../../stores/bookmarks.svelte';
  import { getNotesTreeStore } from '../../stores/notes-tree.svelte';
  import { flattenVisible } from '../../sidebar-tree-utils';
  import { getSidebarSettings, setSidebarSettings } from '../../sidebar/settings';
  import type { SidebarFileOps } from './panels';
  import { tick, untrack } from 'svelte';

  let { onFileSelect, fileOps }: { onFileSelect: (relativePath: string, searchQuery?: string) => void; fileOps: SidebarFileOps } = $props();

  const notebase = getNotebaseStore();
  const editorStore = getEditorStore();
  const clipboard = getClipboardStore();
  const bookmarksStore = getBookmarksStore();
  const tree = getNotesTreeStore();

  const files = $derived(notebase.files);
  const rootName = $derived(notebase.meta?.name);
  const activeFilePath = $derived(editorStore.activeFilePath);
  const canPaste = $derived(clipboard.current !== null);
  let rootDropHover = $state(false);

  /** Mirrored from sidebar/settings so the toolbar toggle reflects the
   *  current state and persists changes write-through. */
  let autoReveal = $state(getSidebarSettings().autoReveal);
  function toggleAutoReveal(): void {
    autoReveal = !autoReveal;
    setSidebarSettings({ autoReveal });
  }

  let contextMenu = $state<{ x: number; y: number } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();


  const selectionStore = getSidebarSelectionStore();

  function toggleDir(path: string): void {
    tree.expanded = { ...tree.expanded, [path]: !tree.expanded[path] };
  }

  /** Walk every directory in the tree, regardless of current tree.expanded
   *  state. Used by Expand All. */
  function collectAllDirPaths(nodes: NoteFile[]): string[] {
    const out: string[] = [];
    const walk = (ns: NoteFile[]) => {
      for (const n of ns) {
        if (n.isDirectory) {
          out.push(n.relativePath);
          if (n.children) walk(n.children);
        }
      }
    };
    walk(nodes);
    return out;
  }

  function expandAll(): void {
    const next: Record<string, boolean> = {};
    for (const p of collectAllDirPaths(files)) next[p] = true;
    tree.expanded = next;
    if (rootName) tree.rootExpanded = true;
  }

  function collapseAll(): void {
    tree.expanded = {};
  }

  /** Expand every ancestor folder of `path` so the row becomes
   *  visible. Pure-additive: never collapses anything the user has
   *  open (#460). */
  function expandAncestors(path: string): void {
    if (!path) return;
    const parts = path.split('/');
    if (parts.length <= 1) return;
    const patch: Record<string, boolean> = {};
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
      if (!tree.expanded[acc]) patch[acc] = true;
    }
    if (Object.keys(patch).length > 0) {
      tree.expanded = { ...tree.expanded, ...patch };
    }
  }

  /** Auto-reveal the active file in the tree (#460). Expands ancestor
   *  folders and scrolls the row into view whenever the active file
   *  changes. Disabled via the sidebar setting. Skipped when the
   *  Notes panel isn't visible (no DOM target to scroll). */
  $effect(() => {
    const path = activeFilePath;
    if (!path) return;
    if (!autoReveal) return;
    // Reveal is driven by the ACTIVE FILE changing (the deps read above), not by
    // the user toggling folders. `expandAncestors` reads `tree.expanded` and
    // `setSingle` touches the selection, so without `untrack` this effect would
    // take a dependency on both — and a plain folder click (which writes
    // `tree.expanded` via toggleDir + `selected` via setSingle) would re-run it,
    // re-expanding the ancestor and re-selecting the active file, i.e. instantly
    // reverting the click. That made the folder containing the active file
    // impossible to select/collapse (#1034).
    untrack(() => {
      if (rootName && !tree.rootExpanded) tree.rootExpanded = true;
      expandAncestors(path);
      void scrollPathIntoView(path);
      // Selection follows the revealed file: single-select it so a stale
      // selection from before the active file changed (via tab switch, a link,
      // the command palette, …) doesn't stay highlighted alongside it.
      selectionStore.setSingle(path);
    });
  });

  async function scrollPathIntoView(path: string): Promise<void> {
    await tick();
    if (!fileListEl) return;
    const escaped = (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(path) : path);
    const row = fileListEl.querySelector(`[data-relative-path="${escaped}"]`);
    if (row && row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /**
   * Imperative reveal for a folder path — switches to the Notes panel,
   * expands the folder and every ancestor, scrolls it into view. Used
   * by the BreadcrumbsBar above the editor (#476) when the user
   * clicks a folder segment.
   */
  export async function revealFolder(folderPath: string): Promise<void> {
    if (!folderPath) return;
    if (rootName && !tree.rootExpanded) tree.rootExpanded = true;
    // Expand every prefix path (including the folder itself).
    const parts = folderPath.split('/').filter(Boolean);
    const patch: Record<string, boolean> = {};
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      if (!tree.expanded[acc]) patch[acc] = true;
    }
    if (Object.keys(patch).length > 0) {
      tree.expanded = { ...tree.expanded, ...patch };
    }
    await scrollPathIntoView(folderPath);
  }

  /**
   * Imperative reveal for a file (note) — switches to the Notes panel,
   * expands the note's ancestor folders, selects it, and scrolls it into
   * view. Used by the tab context menu's "Reveal in Sidebar" (the in-app
   * counterpart to "Reveal in Finder"). Doesn't open the note — it's
   * already open if you're revealing its tab.
   */
  export async function revealFile(relativePath: string): Promise<void> {
    if (!relativePath) return;
    if (rootName && !tree.rootExpanded) tree.rootExpanded = true;
    // Expand every ANCESTOR folder — drop the filename itself (not a folder).
    const parts = relativePath.split('/').filter(Boolean);
    parts.pop();
    const patch: Record<string, boolean> = {};
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      if (!tree.expanded[acc]) patch[acc] = true;
    }
    if (Object.keys(patch).length > 0) {
      tree.expanded = { ...tree.expanded, ...patch };
    }
    selectionStore.setSingle(relativePath);
    await scrollPathIntoView(relativePath);
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
  const totalVisible = $derived(flattenVisible(files, tree.expanded).length);

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
      selectionStore.selectRange(path, flattenVisible(files, tree.expanded));
      return;
    }
    if (mods.meta) {
      selectionStore.toggle(path);
      return;
    }
    selectionStore.setSingle(path);
    // A plain click selects. Folders no longer expand/collapse on a row click —
    // that's the chevron's job (#1034 follow-up) — so selecting a folder doesn't
    // disturb what's open. Files still open on click.
    if (!isDirectory) {
      onFileSelect(path);
    }
  }

  /** Ctrl/Cmd-A while focus is in the sidebar selects every visible row. */
  function handleKeyDown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      selectionStore.selectAll(flattenVisible(files, tree.expanded));
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
    const visible = flattenVisible(files, tree.expanded);
    // ⌘-↓/↑ on a focused folder: expand / collapse. Targets the
    // currently-focused row, not the next one. Fold the current row
    // open or shut without disturbing the cursor.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const cur = selectionStore.focused;
      if (!cur) return;
      const node = findNode(files, cur);
      if (!node?.isDirectory) return;
      e.preventDefault();
      const isExpanded = !!tree.expanded[cur];
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
        // Move focus + single-select, but DON'T open the file.
        // Opening would steal focus to the editor and break the next
        // arrow press; Finder / VS Code arrow nav follows the same
        // rule — arrow walks the cursor; Enter opens.
        selectionStore.setSingle(next);
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


  function handleBookmark(path: string): void {
    const name = path.split('/').pop()?.replace(/\.(md|ttl|csv)$/, '') ?? path;
    bookmarksStore.add(name, path);
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


  function openRootContextMenu(x: number, y: number) {
    contextMenu = { x, y };
    installDismissOnClickOutside(() => { contextMenu = null; });
  }

  function handleContextMenu(e: MouseEvent) {
    // Let FileTree's own context menu handle clicks on tree items
    // (except the synthetic root row, which has no FileTree handler).
    const target = e.target as HTMLElement;
    const treeItem = target.closest('.tree-item');
    if (treeItem && !treeItem.classList.contains('root-item')) return;
    e.preventDefault();
    openRootContextMenu(e.clientX, e.clientY);
  }

</script>

<svelte:window onkeydown={handleKeyDown} />

  {#if files.length > 0}
    <div class="notes-toolbar">
      <button
        type="button"
        class="tool-btn"
        onclick={expandAll}
        title="Expand all folders"
        aria-label="Expand all folders"
      ><Icon name="expandAll" size={14} /></button>
      <button
        type="button"
        class="tool-btn"
        onclick={collapseAll}
        title="Collapse all folders"
        aria-label="Collapse all folders"
      ><Icon name="collapseAll" size={14} /></button>
      <button
        type="button"
        class="tool-btn"
        class:active={autoReveal}
        onclick={toggleAutoReveal}
        title={autoReveal ? 'Auto-reveal active file: on' : 'Auto-reveal active file: off'}
        aria-label="Toggle auto-reveal active file"
        aria-pressed={autoReveal}
      ><Icon name="reveal" size={14} /></button>
    </div>
    {#if selectionStore.count > 0}
      <div class="selection-badge">
        <span class="count">{selectionStore.count} of {totalVisible} selected</span>
        <button class="clear-btn" onclick={() => selectionStore.clear()}>clear</button>
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
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
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
          fileOps.onExternalDrop?.('', e.dataTransfer);
          return;
        }
        const src = e.dataTransfer!.getData('text/plain');
        if (src) fileOps.onMove(src, '');
      }}
    >
      {#if rootName}
        <button
          type="button"
          class="tree-item dir root-item"
          onclick={() => tree.rootExpanded = !tree.rootExpanded}
          title={rootName}
        >
          <span class="chev">
            <Icon name={tree.rootExpanded ? 'chevronDown' : 'chevronRight'} size={11} />
          </span>
          <Icon name={tree.rootExpanded ? 'folderOpen' : 'folder'} size={14} />
          <span class="row-label">{rootName}</span>
        </button>
      {/if}
      {#if tree.rootExpanded}
        <FileTree
          {files}
          {activeFilePath}
          depth={rootName ? 1 : 0}
          {canPaste}
          expanded={tree.expanded}
          selection={selectionStore.selected}
          focusedPath={selectionStore.focused}
          onToggleDir={toggleDir}
          onItemClick={handleItemClick}
          onNewNote={fileOps.onNewNote}
          onNewFolder={fileOps.onNewFolder}
          onDelete={fileOps.onDelete}
          onAddTag={fileOps.onAddTag}
          onLabelVersion={fileOps.onLabelVersion}
          onViewHistory={fileOps.onViewHistory}
          onRemoveTag={fileOps.onRemoveTag}
          onAddProperty={fileOps.onAddProperty}
          onRemoveProperty={fileOps.onRemoveProperty}
          onFormat={fileOps.onFormat}
          onContextMenuTarget={handleContextMenuTarget}
          onRename={fileOps.onRename}
          onMerge={fileOps.onMerge}
          onCut={fileOps.onCut}
          onCopy={fileOps.onCopy}
          onPaste={fileOps.onPaste}
          onMove={fileOps.onMove}
          onBookmark={handleBookmark}
          onToggleEntrypoint={fileOps.onToggleEntrypoint}
          onExternalDrop={fileOps.onExternalDrop}
        />
      {/if}
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
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
    <NotesRootMenu
      {canPaste}
      onPaste={() => fileOps.onPaste('')}
      onNewNote={() => fileOps.onNewNote('')}
      onNewFolder={() => fileOps.onNewFolder('')}
      {...(fileOps.onLabelVersion ? { onLabelVersion: () => fileOps.onLabelVersion?.('', true, { targetOnly: true }) } : {})}
      {...(fileOps.onViewHistory ? { onViewHistory: () => fileOps.onViewHistory?.('', true, { targetOnly: true }) } : {})}
      onDone={() => { contextMenu = null; }}
    />
  </div>
{/if}

<style>
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

  /* Toolbar above the file tree — Expand All / Collapse All (#460). */
  .notes-toolbar {
    display: flex;
    gap: 2px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .tool-btn {
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .tool-btn:hover {
    background: var(--bg-button);
    color: var(--text);
  }
  .tool-btn.active {
    background: var(--bg-button-hover);
    color: var(--accent);
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

  /* Synthetic root row at the top of the file tree. Mimics the
     `.tree-item.dir` look from FileTree (we can't share styles
     across component boundaries with scoped CSS) so it reads as
     "the project folder" rather than a one-off header. */
  .tree-item.root-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 12px 5px;
    border: none;
    border-left: 2px solid transparent;
    background: none;
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
  }
  .tree-item.root-item:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
  }
  .tree-item.root-item :global(svg) {
    flex-shrink: 0;
  }
  .tree-item.root-item .chev {
    width: 11px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-faint);
  }
  .tree-item.root-item .row-label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

  /* Base shape shared via .context-menu in global.css (#1910); only the
     per-instance min-width stays local. */
  .context-menu {
    min-width: 140px;
  }
</style>
