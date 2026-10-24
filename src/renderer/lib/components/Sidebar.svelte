<script lang="ts">
  /**
   * The left sidebar: an icon rail of panels, the active one's header, and
   * its body. Which panels exist, and what each is drawn from, is the
   * registry's (`sidebar/panels.ts`, #2626) — this shell iterates it. The
   * Notes panel (`sidebar/NotesPanel.svelte`) holds the file tree.
   *
   * The host still reaches into the mounted panel for a few things — a
   * refresh after an outside change, revealing a note, selecting a tag —
   * through `callActive`, which does nothing when that panel isn't the one
   * showing (it refetches on its next mount anyway).
   */
  import type { NoteFile } from '../../../shared/types';
  import Icon from './Icon.svelte';
  import { getSidebarSelectionStore } from '../stores/sidebar-selection.svelte';
  import { objectTypesStore } from '../stores/object-types.svelte';
  import { getProposalsStore } from '../stores/proposals.svelte';
  import { getNotebaseStore } from '../stores/notebase.svelte';
  import { getDialogStore } from '../stores/dialogs.svelte';
  import { LEFT_PANELS, pluginLeftPanels, type LeftPanel, type LeftPanelHost, type LeftPanelId, type SidebarFileOps, type SidebarPanelOps } from './sidebar/panels';
  import { corePluginsStore } from '../stores/core-plugins.svelte';
  import type { PluginPanelId } from './plugins/plugin-panels';
  import { tick } from 'svelte';

  type PanelType = LeftPanelId | PluginPanelId;

  /** Recursively count files (not folders) in the tree — drives the
   *  count chip in the Notes panel header. */
  function countFiles(nodes: NoteFile[] | undefined): number {
    if (!nodes) return 0;
    let n = 0;
    for (const node of nodes) {
      if (node.isDirectory) n += countFiles(node.children);
      else n++;
    }
    return n;
  }

  interface Props {
    onFileSelect: (relativePath: string, searchQuery?: string) => void;
    fileOps: SidebarFileOps;
    panelOps?: SidebarPanelOps;
  }

  let { onFileSelect, fileOps, panelOps }: Props = $props();

  const notebase = getNotebaseStore();
  const dialogs = getDialogStore();
  const selectionStore = getSidebarSelectionStore();
  // Read-only: the pending-proposal count is the Proposals tab's cue
  // (#1541 follow-up), the same accent signal as the status-bar / dock badge.
  const proposalsStore = getProposalsStore();

  let activePanel = $state<PanelType>('notes');
  const notesCount = $derived(countFiles(notebase.files));
  // The core panels, then those plugins' global views add (#2640) — which
  // come and go as plugins are turned on and off.
  const panels: ReadonlyArray<LeftPanel & { id: PanelType }> = $derived([...LEFT_PANELS, ...pluginLeftPanels(corePluginsStore.views('left-sidebar'))]);
  const PANEL_DEFS: ReadonlyMap<PanelType, LeftPanel> = $derived(new Map(panels.map((p) => [p.id, p] as const)));
  // A plugin panel whose plugin was turned off falls back to Notes.
  const activeDef = $derived(PANEL_DEFS.get(activePanel) ?? PANEL_DEFS.get('notes'));
  const shownPanel = $derived<PanelType>(PANEL_DEFS.has(activePanel) ? activePanel : 'notes');

  // Seed the note→type map once on mount so Notes-tree rows carry their type
  // icons from the first paint. A project restored at startup doesn't go
  // through the menu-open path that calls refreshObjects().
  $effect(() => { void objectTypesStore.refresh(); });

  /** What every panel is drawn from — getters over this sidebar's props, so a
   *  panel's `props(host)` reads them live. */
  const host: LeftPanelHost = {
    get onFileSelect() { return onFileSelect; },
    get fileOps() { return fileOps; },
    get panelOps() { return panelOps; },
    showConfirm: dialogs.showConfirm,
    showPrompt: dialogs.showPrompt,
    get notesCount() { return notesCount; },
    get pendingProposals() { return proposalsStore.pendingCount; },
  };

  /** The mounted panel. */
  let panelInstance = $state<Record<string, unknown>>();

  /** Call `method` on panel `id` if it's the one mounted; otherwise nothing. */
  function callActive(id: PanelType, method: string, ...args: unknown[]): unknown {
    if (shownPanel !== id) return undefined;
    const fn = panelInstance?.[method];
    return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown).apply(panelInstance, args) : undefined;
  }

  /** Switch to `id` and wait for it to mount, so it can be called. */
  async function showAndMount(id: PanelType): Promise<void> {
    activePanel = id;
    await tick();
  }

  export function getSelectionPaths(): string[] {
    return selectionStore.paths();
  }
  export function clearSelection(): void {
    selectionStore.clear();
  }

  /**
   * Imperative reveal for a folder path — switches to the Notes panel,
   * expands the folder and every ancestor, scrolls it into view. Used by the
   * BreadcrumbsBar above the editor (#476) when the user clicks a folder.
   */
  export async function revealFolder(folderPath: string): Promise<void> {
    if (!folderPath) return;
    await showAndMount('notes');
    await callActive('notes', 'revealFolder', folderPath);
  }

  /**
   * Imperative reveal for a note — switches to the Notes panel, expands its
   * ancestor folders, selects it and scrolls it into view. Used by the tab
   * context menu's "Reveal in Sidebar". Doesn't open the note.
   */
  export async function revealFile(relativePath: string): Promise<void> {
    if (!relativePath) return;
    await showAndMount('notes');
    await callActive('notes', 'revealFile', relativePath);
  }

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

  // Refreshing a panel the host changed data under: a no-op when it isn't
  // the mounted one, since a panel refetches on its next mount.
  export function refreshTags() {
    callActive('tags', 'refresh');
  }

  export function refreshSources() {
    callActive('sites', 'refresh');
  }

  export function refreshTables() {
    callActive('tables', 'refresh');
  }

  export function refreshObjects() {
    // Unconditional: the note→type map drives the type icons on Notes-tree
    // rows, so it has to stay fresh whether or not the Objects panel is the
    // mounted one. The panel's own refresh is still a no-op when it isn't.
    void objectTypesStore.refresh();
    void callActive('objects', 'refresh');
  }

  /** Switch the active left-sidebar view (e.g. App opens 'proposals' when the
   *  status-bar pending badge is clicked, #1528). */
  export function showPanel(panel: PanelType) {
    activePanel = panel;
  }

  export function selectTag(tag: string) {
    activePanel = 'tags';
    // Wait for TagPanel to mount before driving it.
    setTimeout(() => {
      callActive('tags', 'refresh');
      setTimeout(() => callActive('tags', 'selectTag', tag), 50);
    }, 0);
  }
</script>

<aside class="sidebar" style:width="{width}px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize-handle" class:dragging onmousedown={startResize}></div>

  <div class="panel-tabs">
    {#each panels as p (p.id)}
      {@const active = shownPanel === p.id}
      {@const badge = p.badge?.(host)}
      {@const pending = badge?.count ?? 0}
      <button
        class="panel-tab"
        class:active
        onclick={() => activePanel = p.id}
        title={p.label}
      >
        <Icon name={p.icon} size={14} color={active || pending > 0 ? 'var(--accent)' : 'currentColor'} />
        {#if active}<span class="panel-tab-label">{p.label}</span>{/if}
        {#if badge && pending > 0}<span class="tab-badge" aria-label={badge.label}>{pending}</span>{/if}
      </button>
    {/each}
  </div>

  <div class="panel-header">
    <h2 class="panel-title">{activeDef?.label ?? ''}</h2>
    <div class="panel-actions">
      {#if activeDef?.count}
        {@const count = activeDef.count(host)}
        <span class="panel-count" title={count.title}>{count.value}</span>
      {/if}
    </div>
  </div>

  <div class="panel-content">
    {#if activeDef && (activeDef.available?.(host) ?? true)}
      {#key shownPanel.startsWith('plugin:') ? shownPanel : ''}
        <activeDef.component bind:this={panelInstance} {...activeDef.props(host)} />
      {/key}
    {/if}
  </div>
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
    padding: 10px 10px 4px;
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
    position: relative;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: none;
    border-radius: 7px;
    background: none;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 450;
    cursor: pointer;
  }

  /* Pending-proposals cue (#1541 follow-up): a small count badge on the
     Proposals tab, in --accent — a prompt to review, not a warning (no danger
     styling per CLAUDE.md), matching the status-bar / dock badge. */
  .tab-badge {
    position: absolute;
    top: -1px;
    right: -1px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    box-sizing: border-box;
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 9px;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
  }

  .panel-tab:hover:not(.active) {
    color: var(--text);
  }

  .panel-tab.active {
    padding: 6px 10px;
    background: var(--bg);
    color: var(--text);
    font-weight: 500;
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .panel-tab-label {
    line-height: 1;
  }

  .panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 10px 16px 8px;
    flex-shrink: 0;
  }
  .panel-title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.01em;
    margin: 0;
    color: var(--text);
  }
  .panel-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-faint);
  }
  .panel-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .panel-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

</style>
