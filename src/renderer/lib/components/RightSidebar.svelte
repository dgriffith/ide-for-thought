<script lang="ts">
  import OutlinePanel from './right-sidebar/OutlinePanel.svelte';
  import FootnotesPanel from './right-sidebar/FootnotesPanel.svelte';
  import PropertiesPanel from './right-sidebar/PropertiesPanel.svelte';
  import OutgoingLinksPanel from './right-sidebar/OutgoingLinksPanel.svelte';
  import BacklinksPanel from './right-sidebar/BacklinksPanel.svelte';
  import TagsPanel from './right-sidebar/TagsPanel.svelte';
  import BookmarksPanel from './right-sidebar/BookmarksPanel.svelte';
  import InspectionsPanel from './right-sidebar/InspectionsPanel.svelte';
  import ProposalsPanel from './right-sidebar/ProposalsPanel.svelte';
  import TablesPanel from './right-sidebar/TablesPanel.svelte';
  import CitationsPanel from './right-sidebar/CitationsPanel.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons/registry';

  type PanelType =
    | 'outline' | 'footnotes' | 'properties' | 'outgoing' | 'backlinks' | 'tags' | 'tables' | 'citations'
    | 'bookmarks' | 'inspections' | 'proposals';

  const PANEL_TABS: ReadonlyArray<{ id: PanelType; label: string; icon: IconName }> = [
    { id: 'outline',     label: 'Outline',        icon: 'outline' },
    { id: 'footnotes',   label: 'Footnotes',      icon: 'footnotes' },
    { id: 'properties',  label: 'Properties',     icon: 'properties' },
    { id: 'outgoing',    label: 'Outgoing Links', icon: 'outgoing' },
    { id: 'backlinks',   label: 'Backlinks',      icon: 'backlinks' },
    { id: 'tags',        label: 'Tags',           icon: 'tags' },
    { id: 'tables',      label: 'Tables',         icon: 'tables' },
    { id: 'citations',   label: 'Citations',      icon: 'citations' },
    { id: 'bookmarks',   label: 'Bookmarks',      icon: 'bookmark' },
    { id: 'inspections', label: 'Inspections',    icon: 'inspections' },
    { id: 'proposals',   label: 'Proposals',      icon: 'proposals' },
  ];

  interface Props {
    activeFilePath: string | null;
    content: string;
    onFileSelect: (relativePath: string) => void;
    /** Short-form wiki-link resolver — handles `[[basename]]`, aliases,
     *  and slug-fuzzy matches. Used by the Properties panel's wiki-link
     *  value chip (#489) so clicking opens the right note regardless of
     *  how the target is written. */
    onNavigate?: (target: string) => void | Promise<void>;
    onScrollToLine: (line: number) => void;
    onShowPrompt: (message: string) => Promise<string | null>;
    onOpenConversation?: (message: string) => void;
    onOpenQuery: (sql: string) => void;
    onOpenSource: (sourceId: string) => void;
    onOpenExcerpt: (excerptId: string) => void;
    onContentChange?: (next: string) => void;
  }

  let {
    activeFilePath, content, onFileSelect, onNavigate, onScrollToLine, onShowPrompt,
    onOpenConversation, onOpenQuery, onOpenSource, onOpenExcerpt,
    onContentChange,
  }: Props = $props();

  let activePanel = $state<PanelType>('outline');
  let revision = $state(0);

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
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
  <div class="resize-handle" class:dragging onmousedown={startResize}></div>
  <div class="panel-tabs">
    {#each PANEL_TABS as t (t.id)}
      <button
        class="panel-tab"
        class:active={activePanel === t.id}
        onclick={() => activePanel = t.id}
        title={t.label}
      ><Icon name={t.icon} size={14} /></button>
    {/each}
  </div>

  <div class="panel-content">
    {#if activePanel === 'outline'}
      <OutlinePanel {content} {onScrollToLine} />
    {:else if activePanel === 'footnotes'}
      <FootnotesPanel {content} {onScrollToLine} />
    {:else if activePanel === 'properties'}
      {#if onContentChange}
        <PropertiesPanel {content} {onContentChange} {onNavigate} />
      {:else}
        <div class="panel-disabled">No active note.</div>
      {/if}
    {:else if activePanel === 'outgoing'}
      <OutgoingLinksPanel {activeFilePath} {revision} {onFileSelect} />
    {:else if activePanel === 'backlinks'}
      <BacklinksPanel {activeFilePath} {revision} {onFileSelect} />
    {:else if activePanel === 'tags'}
      <TagsPanel {content} {onFileSelect} />
    {:else if activePanel === 'tables'}
      <TablesPanel {content} {onOpenQuery} />
    {:else if activePanel === 'citations'}
      <CitationsPanel {activeFilePath} {content} {revision} {onOpenSource} {onOpenExcerpt} />
    {:else if activePanel === 'bookmarks'}
      <BookmarksPanel {onFileSelect} {onShowPrompt} />
    {:else if activePanel === 'inspections'}
      <InspectionsPanel {revision} {onOpenConversation} />
    {:else if activePanel === 'proposals'}
      <ProposalsPanel {revision} />
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

  .panel-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: auto;
    scrollbar-width: thin;
  }
  /* Match the bespoke thin scrollbar used on tab bars elsewhere so the
     row is unobtrusive when it doesn't overflow. */
  .panel-tabs::-webkit-scrollbar {
    height: 6px;
  }
  .panel-tabs::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 3px;
  }

  .panel-tab {
    flex-shrink: 0;
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
  }

  .panel-tab:hover {
    background: var(--bg-button);
  }

  .panel-tab.active {
    background: var(--bg-button-hover);
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
