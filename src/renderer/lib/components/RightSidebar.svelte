<script lang="ts">
  import OutlinePanel from './right-sidebar/OutlinePanel.svelte';
  import HeadingGraphPanel from './right-sidebar/HeadingGraphPanel.svelte';
  import FootnotesPanel from './right-sidebar/FootnotesPanel.svelte';
  import PropertiesPanel from './right-sidebar/PropertiesPanel.svelte';
  import OutgoingLinksPanel from './right-sidebar/OutgoingLinksPanel.svelte';
  import BacklinksPanel from './right-sidebar/BacklinksPanel.svelte';
  import RelatedPanel from './right-sidebar/RelatedPanel.svelte';
  import TagsPanel from './right-sidebar/TagsPanel.svelte';
  import BookmarksPanel from './right-sidebar/BookmarksPanel.svelte';
  import InspectionsPanel from './right-sidebar/InspectionsPanel.svelte';
  import TablesPanel from './right-sidebar/TablesPanel.svelte';
  import CitationsPanel from './right-sidebar/CitationsPanel.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons/registry';

  type PanelType =
    | 'outline' | 'headingGraph' | 'footnotes' | 'properties' | 'outgoing' | 'backlinks' | 'related' | 'tags' | 'tables' | 'citations'
    | 'bookmarks' | 'inspections';

  type PanelGroupId = 'note' | 'links' | 'activity';

  interface PanelDef {
    id: PanelType;
    label: string;
    icon: IconName;
  }
  interface GroupDef {
    id: PanelGroupId;
    label: string;
    items: ReadonlyArray<PanelDef>;
  }

  /**
   * Eleven panels collapsed into three semantic groups per
   * IMPLEMENTATION.md §6.1. `activePanel` is unchanged externally — the
   * status bar's onShowBacklinks etc. still calls `showPanel(panel)`
   * and `activeGroup` is derived from the chosen panel.
   */
  const GROUPS: ReadonlyArray<GroupDef> = [
    {
      id: 'note',
      label: 'Note',
      items: [
        { id: 'outline',    label: 'Outline',    icon: 'outline' },
        { id: 'headingGraph', label: 'Heading Map', icon: 'graph' },
        { id: 'properties', label: 'Properties', icon: 'properties' },
        { id: 'footnotes',  label: 'Footnotes',  icon: 'footnotes' },
        // Tags and Tables describe what's *inside* the active note's
        // content, not how it connects to other notes — they sit
        // alongside Outline / Properties under Note rather than
        // sharing space with Outgoing / Backlinks under Links.
        { id: 'tags',       label: 'Tags',       icon: 'tags' },
        { id: 'tables',     label: 'Tables',     icon: 'tables' },
      ],
    },
    {
      id: 'links',
      label: 'Links',
      items: [
        { id: 'outgoing',  label: 'Outgoing',  icon: 'outgoing' },
        { id: 'backlinks', label: 'Backlinks', icon: 'backlinks' },
        { id: 'related',   label: 'Related',   icon: 'sparkle' },
        { id: 'citations', label: 'Citations', icon: 'citations' },
        { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
      ],
    },
    // Activity group retired (#1527): proposals moved to the always-available
    // left sidebar (#1523), and Inspections is hidden for v1.0. The
    // InspectionsPanel component, its 'inspections' PanelType, and its render
    // branch below are kept dormant — to re-enable, restore an Activity group
    // here with a `{ id: 'inspections', … }` tab entry.
  ];

  /** Reverse lookup: panel → its parent group. Built once at module
   *  init so click handlers don't reduce on every render. */
  const PANEL_TO_GROUP: ReadonlyMap<PanelType, PanelGroupId> = new Map(
    GROUPS.flatMap((g) => g.items.map((i) => [i.id, g.id] as const)),
  );

  const PANEL_DEFS: ReadonlyMap<PanelType, PanelDef> = new Map(
    GROUPS.flatMap((g) => g.items.map((i) => [i.id, i] as const)),
  );

  interface Props {
    activeFilePath: string | null;
    content: string;
    onFileSelect: (relativePath: string) => void;
    /** Short-form wiki-link resolver — handles `[[basename]]`, aliases,
     *  and slug-fuzzy matches. Used by the Properties panel's wiki-link
     *  value chip (#489) so clicking opens the right note regardless of
     *  how the target is written. */
    onNavigate?: (target: string) => void | Promise<void>;
    /** Open a note and jump to a character offset (line bookmarks, #756). */
    onOpenAtOffset?: (relativePath: string, offset: number) => void | Promise<void>;
    onScrollToLine: (line: number) => void;
    onOpenConversation?: (message: string) => void;
    onOpenQuery: (sql: string) => void;
    onOpenSource: (sourceId: string) => void;
    onOpenExcerpt: (excerptId: string) => void;
    onContentChange?: (next: string) => void;
    /** Open a note's link neighborhood as a graph (#847). */
    onOpenGraph?: (relativePath: string) => void;
    /** True while the semantic-index backfill is running (#836/#838). */
    indexing?: boolean;
  }

  let {
    activeFilePath, content, onFileSelect, onNavigate, onOpenAtOffset, onScrollToLine,
    onOpenConversation, onOpenQuery, onOpenSource, onOpenExcerpt,
    onContentChange, onOpenGraph, indexing = false,
  }: Props = $props();

  let activePanel = $state<PanelType>('outline');
  let revision = $state(0);

  // View A (#845) root label — the note's filename stem.
  const noteTitle = $derived(
    activeFilePath ? (activeFilePath.split('/').pop() ?? activeFilePath).replace(/\.md$/i, '') : 'Note',
  );
  let headingGraphPanel = $state<HeadingGraphPanel>();

  /** Re-skin the graph panel on theme switch (called from App.svelte). The
   *  cytoscape graph re-styles live; other panels are plain DOM. */
  export function updateTheme(): void {
    headingGraphPanel?.updateTheme();
  }

  /** Group is derived from the active panel — keeps `showPanel(p)` as
   *  the single way to switch the right sidebar's state. Clicking a
   *  group label sets `activePanel` to its first item, which flows back
   *  into `activeGroup` through this derivation. */
  const activeGroup = $derived(PANEL_TO_GROUP.get(activePanel) ?? 'note');
  const activeGroupDef = $derived(GROUPS.find((g) => g.id === activeGroup) ?? GROUPS[0]!);
  const activePanelDef = $derived(PANEL_DEFS.get(activePanel));

  function pickGroup(g: GroupDef) {
    if (g.id === activeGroup) return;
    activePanel = g.items[0]!.id;
  }

  // Width is user-draggable and persists across sessions. localStorage
  // rather than a settings channel — the value is per-machine UI state,
  // not a project-scoped preference worth the IPC plumbing.
  const WIDTH_KEY = 'minerva.rightSidebarWidth';
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 600;
  const initial = (() => {
    const v = parseInt(localStorage.getItem(WIDTH_KEY) ?? '', 10);
    if (Number.isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH) return v;
    return 250;
  })();
  let width = $state(initial);
  let dragging = $state(false);

  function startResize(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (me: MouseEvent) => {
      // Drag handle is on the left edge; moving the mouse left grows
      // the sidebar, right shrinks it.
      const next = startWidth + (startX - me.clientX);
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

  export function refresh() {
    revision++;
  }

  /** Programmatically switch which tab is showing. Used by the status
   *  bar's backlink-count click to drop the user straight into the
   *  Backlinks panel. */
  export function showPanel(panel: PanelType) {
    activePanel = panel;
  }
</script>

<aside class="right-sidebar" style:width="{width}px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize-handle" class:dragging onmousedown={startResize}></div>
  <!-- Top row: group chips -->
  <div class="group-strip">
    {#each GROUPS as g (g.id)}
      {@const active = activeGroup === g.id}
      <button
        class="group-tab"
        class:active
        onclick={() => pickGroup(g)}
        title={g.label}
      >
        <span class="group-label">{g.label}</span>
      </button>
    {/each}
  </div>

  <!-- Sub row: items of the active group -->
  <div class="sub-strip">
    {#each activeGroupDef.items as it (it.id)}
      {@const active = activePanel === it.id}
      <button
        class="sub-tab"
        class:active
        onclick={() => activePanel = it.id}
        title={it.label}
      >
        <Icon name={it.icon} size={13} color={active ? 'var(--accent)' : 'currentColor'} />
        <span>{it.label}</span>
      </button>
    {/each}
  </div>

  <!-- Per-panel header (display-serif title + reserved actions slot).
       Panel bodies inherit the type/color tokens; richer per-panel
       headers (counts, actions) land with each body redesign in #548. -->
  {#if activePanelDef}
    <div class="panel-header">
      <h2 class="panel-title">{activePanelDef.label}</h2>
    </div>
  {/if}

  <div class="panel-content">
    {#if activePanel === 'outline'}
      <OutlinePanel {content} {onScrollToLine} />
    {:else if activePanel === 'headingGraph'}
      <HeadingGraphPanel bind:this={headingGraphPanel} {content} title={noteTitle} {onScrollToLine} />
    {:else if activePanel === 'footnotes'}
      <FootnotesPanel {content} {onScrollToLine} />
    {:else if activePanel === 'properties'}
      {#if onContentChange}
        <PropertiesPanel {content} {onContentChange} {...(onNavigate !== undefined ? { onNavigate } : {})} />
      {:else}
        <div class="panel-disabled">No active note.</div>
      {/if}
    {:else if activePanel === 'outgoing'}
      <OutgoingLinksPanel {activeFilePath} {revision} {onFileSelect} {...(onOpenGraph !== undefined ? { onOpenGraph } : {})} />
    {:else if activePanel === 'backlinks'}
      <BacklinksPanel {activeFilePath} {revision} {onFileSelect} {...(onOpenGraph !== undefined ? { onOpenGraph } : {})} />
    {:else if activePanel === 'related'}
      <RelatedPanel {activeFilePath} {revision} {indexing} {onFileSelect} {...(onNavigate !== undefined ? { onNavigate } : {})} onOpenSource={onOpenSource} onOpenExcerpt={onOpenExcerpt} />
    {:else if activePanel === 'tags'}
      <TagsPanel {content} {onFileSelect} onSourceSelect={onOpenSource} />
    {:else if activePanel === 'tables'}
      <TablesPanel {activeFilePath} {content} {revision} {onOpenQuery} />
    {:else if activePanel === 'citations'}
      <CitationsPanel {activeFilePath} {content} {revision} {onOpenSource} {onOpenExcerpt} />
    {:else if activePanel === 'bookmarks'}
      <BookmarksPanel {activeFilePath} {onFileSelect} {...(onNavigate !== undefined ? { onNavigate } : {})} {...(onOpenAtOffset !== undefined ? { onOpenAtOffset } : {})} />
    {:else if activePanel === 'inspections'}
      <InspectionsPanel {revision} {...(onOpenConversation !== undefined ? { onOpenConversation } : {})} />
    {/if}
  </div>
</aside>

<style>
  .right-sidebar {
    position: relative;
    min-width: 180px;
    background: var(--bg-sidebar);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    left: -3px;
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

  /* ── Group strip (Note · Links · Activity) ──────────────────────── */
  .group-strip {
    display: flex;
    gap: 2px;
    padding: 10px 12px 4px;
    flex-shrink: 0;
  }

  .group-tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
  }
  .group-tab:hover:not(.active) {
    color: var(--text);
  }
  .group-tab.active {
    background: var(--bg);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  /* ── Sub strip (active group's items) ──────────────────────────── */
  .sub-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 12px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .sub-tab {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
  }
  .sub-tab:hover:not(.active) {
    color: var(--text);
  }
  .sub-tab.active {
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    color: var(--accent);
  }

  /* ── Per-panel header ──────────────────────────────────────────── */
  .panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 12px 16px 8px;
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

  .panel-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-disabled {
    padding: 16px;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }
</style>
