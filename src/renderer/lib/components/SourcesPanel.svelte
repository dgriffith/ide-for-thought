<script lang="ts">
  import { api } from '../ipc/client';
  import type { SourceMetadata } from '../../../shared/types';
  import { clampMenuToViewport } from '../utils/menuClamp';

  interface Props {
    onSourceSelect: (sourceId: string) => void;
    onSourceDeleted?: (sourceId: string) => void;
    onShowConfirm: (message: string, key: string, label?: string) => Promise<boolean>;
  }

  let { onSourceSelect, onSourceDeleted, onShowConfirm }: Props = $props();

  let sources = $state<SourceMetadata[]>([]);
  let filter = $state('');
  let collapsed = $state(false);
  let contextMenu = $state<{ x: number; y: number; source: SourceMetadata } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();

  $effect(() => {
    if (!contextMenu || !contextMenuEl) return;
    const next = clampMenuToViewport(contextMenu.x, contextMenu.y, contextMenuEl);
    if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
      contextMenu = { ...contextMenu, ...next };
    }
  });

  function handleContextMenu(e: MouseEvent, source: SourceMetadata) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, source };
    const close = () => { contextMenu = null; window.removeEventListener('click', close); };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  async function handleDelete(source: SourceMetadata) {
    contextMenu = null;
    const label = source.title ?? source.sourceId;
    const confirmed = await onShowConfirm(
      `Delete source "${label}"? Any excerpts from this source will also be removed.`,
      'delete-source',
      'Delete',
    );
    if (!confirmed) return;
    await api.sources.delete(source.sourceId);
    onSourceDeleted?.(source.sourceId);
    await refresh();
  }

  export async function refresh(): Promise<void> {
    sources = await api.sources.listAll();
  }

  let visible = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter((s) => {
      const title = (s.title ?? s.sourceId).toLowerCase();
      const byline = s.creators.join(' ').toLowerCase();
      const year = s.year ?? '';
      return title.includes(q) || byline.includes(q) || year.includes(q) || s.sourceId.includes(q);
    });
  });

  function formatByline(creators: string[], year: string | null): string {
    const who = creators.length === 0 ? ''
      : creators.length === 1 ? creators[0]
      : creators.length === 2 ? `${creators[0]} and ${creators[1]}`
      : `${creators[0]} et al.`;
    if (who && year) return `${who} · ${year}`;
    return who || (year ?? '');
  }
</script>

<div class="sources-panel">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="panel-header" onclick={() => { collapsed = !collapsed; }}>
    <span class="chevron" class:collapsed>▾</span>
    <span>Sources</span>
    <span class="count">{sources.length}</span>
  </div>

  {#if !collapsed}
    {#if sources.length === 0}
      <div class="empty">No sources yet. File → Ingest URL… to start.</div>
    {:else}
      <div class="filter-row">
        <input
          type="text"
          class="filter-input"
          placeholder="Filter sources…"
          bind:value={filter}
        />
      </div>
      <div class="source-list">
        {#each visible as s (s.sourceId)}
          <button
            class="source-item"
            onclick={() => onSourceSelect(s.sourceId)}
            oncontextmenu={(e) => handleContextMenu(e, s)}
            title={s.sourceId}
          >
            <div class="source-title">{s.title ?? s.sourceId}</div>
            {#if s.creators.length > 0 || s.year}
              <div class="source-byline">{formatByline(s.creators, s.year)}</div>
            {/if}
          </button>
        {/each}
        {#if visible.length === 0}
          <div class="empty">No matches.</div>
        {/if}
      </div>
    {/if}
  {/if}

  {#if contextMenu}
    <div
      class="context-menu"
      bind:this={contextMenuEl}
      style:left="{contextMenu.x}px"
      style:top="{contextMenu.y}px"
    >
      <button onclick={() => handleDelete(contextMenu!.source)}>Delete Source</button>
    </div>
  {/if}
</div>

<style>
  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 160px;
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
  .sources-panel {
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    max-height: 40%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
  }

  .chevron {
    display: inline-block;
    transition: transform 0.15s;
  }
  .chevron.collapsed {
    transform: rotate(-90deg);
  }

  .count {
    margin-left: auto;
    font-size: 10px;
    opacity: 0.7;
  }

  .empty {
    padding: 6px 12px 10px;
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .filter-row {
    padding: 0 8px 6px;
  }

  .filter-input {
    width: 100%;
    padding: 4px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 12px;
    box-sizing: border-box;
  }
  .filter-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .source-list {
    flex: 1;
    overflow-y: auto;
    padding-bottom: 6px;
  }

  .source-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 4px 12px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  .source-item:hover {
    background: var(--bg-button);
    border-left-color: var(--accent);
  }

  .source-title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-byline {
    font-size: 10px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 1px;
  }
</style>
