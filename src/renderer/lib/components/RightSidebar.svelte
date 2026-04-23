<script lang="ts">
  import OutlinePanel from './right-sidebar/OutlinePanel.svelte';
  import OutgoingLinksPanel from './right-sidebar/OutgoingLinksPanel.svelte';
  import BacklinksPanel from './right-sidebar/BacklinksPanel.svelte';
  import TagsPanel from './right-sidebar/TagsPanel.svelte';
  import BookmarksPanel from './right-sidebar/BookmarksPanel.svelte';
  import InspectionsPanel from './right-sidebar/InspectionsPanel.svelte';
  import ProposalsPanel from './right-sidebar/ProposalsPanel.svelte';
  import TablesPanel from './right-sidebar/TablesPanel.svelte';
  import CitationsPanel from './right-sidebar/CitationsPanel.svelte';

  type PanelType =
    | 'outline' | 'outgoing' | 'backlinks' | 'tags' | 'tables' | 'citations'
    | 'bookmarks' | 'inspections' | 'proposals';

  interface Props {
    activeFilePath: string | null;
    content: string;
    onFileSelect: (relativePath: string) => void;
    onScrollToLine: (line: number) => void;
    onShowPrompt: (message: string) => Promise<string | null>;
    onOpenConversation?: (message: string) => void;
    onOpenQuery: (sql: string) => void;
    onOpenSource: (sourceId: string) => void;
    onOpenExcerpt: (excerptId: string) => void;
  }

  let {
    activeFilePath, content, onFileSelect, onScrollToLine, onShowPrompt,
    onOpenConversation, onOpenQuery, onOpenSource, onOpenExcerpt,
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
</script>

<aside class="right-sidebar" style:width="{width}px">
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
  <div class="resize-handle" class:dragging onmousedown={startResize}></div>
  <div class="panel-tabs">
    <button
      class="panel-tab"
      class:active={activePanel === 'outline'}
      onclick={() => activePanel = 'outline'}
      title="Outline"
    >&#x2630;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'outgoing'}
      onclick={() => activePanel = 'outgoing'}
      title="Outgoing Links"
    >&#x2192;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'backlinks'}
      onclick={() => activePanel = 'backlinks'}
      title="Backlinks"
    >&#x2190;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'tags'}
      onclick={() => activePanel = 'tags'}
      title="Tags"
    >#</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'tables'}
      onclick={() => activePanel = 'tables'}
      title="Tables"
    >&#x229E;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'citations'}
      onclick={() => activePanel = 'citations'}
      title="Citations"
    >&#x201C;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'bookmarks'}
      onclick={() => activePanel = 'bookmarks'}
      title="Bookmarks"
    >&#x2606;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'inspections'}
      onclick={() => activePanel = 'inspections'}
      title="Inspections"
    >&#x26A0;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'proposals'}
      onclick={() => activePanel = 'proposals'}
      title="Proposals"
    >&#x2713;</button>
  </div>

  <div class="panel-content">
    {#if activePanel === 'outline'}
      <OutlinePanel {content} {onScrollToLine} />
    {:else if activePanel === 'outgoing'}
      <OutgoingLinksPanel {activeFilePath} {revision} {onFileSelect} />
    {:else if activePanel === 'backlinks'}
      <BacklinksPanel {activeFilePath} {revision} {onFileSelect} />
    {:else if activePanel === 'tags'}
      <TagsPanel {content} {onFileSelect} />
    {:else if activePanel === 'tables'}
      <TablesPanel {content} {onOpenQuery} />
    {:else if activePanel === 'citations'}
      <CitationsPanel {content} {onOpenSource} {onOpenExcerpt} />
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
</style>
