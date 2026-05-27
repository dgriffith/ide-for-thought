<script lang="ts">
  import { api } from '../ipc/client';
  import type { SourceMetadata } from '../../../shared/types';
  import { clampMenuToViewport } from '../utils/menuClamp';
  import SourcePickerDialog from './SourcePickerDialog.svelte';

  interface Props {
    onSourceSelect: (sourceId: string) => void;
    onSourceDeleted?: (sourceId: string) => void;
    onShowConfirm: (message: string, key: string, label?: string) => Promise<boolean>;
  }

  let { onSourceSelect, onSourceDeleted, onShowConfirm }: Props = $props();

  let sources = $state<SourceMetadata[]>([]);
  let filter = $state('');
  let contextMenu = $state<{ x: number; y: number; source: SourceMetadata } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();
  /** When set, the merge picker is open with this source as the src. */
  let mergeSrc = $state<SourceMetadata | null>(null);

  $effect(() => {
    if (!contextMenu || !contextMenuEl) return;
    const next = clampMenuToViewport(contextMenu.x, contextMenu.y, contextMenuEl);
    if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
      contextMenu = { ...contextMenu, ...next };
    }
  });

  // Fetch on mount so the panel populates whenever it's switched into,
  // not only when the host calls refresh().
  $effect(() => {
    void refresh();
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

  function handleMergeStart(source: SourceMetadata) {
    contextMenu = null;
    mergeSrc = source;
  }

  async function handleMergePick(destId: string) {
    const src = mergeSrc;
    mergeSrc = null;
    if (!src) return;
    const srcLabel = src.title ?? src.sourceId;
    const dest = sources.find((s) => s.sourceId === destId);
    const destLabel = dest?.title ?? destId;
    const confirmed = await onShowConfirm(
      `Merge "${srcLabel}" into "${destLabel}"?\n\nExcerpts and citations of "${srcLabel}" will move to "${destLabel}", then "${srcLabel}" will be removed.`,
      'merge-sources',
      'Merge',
    );
    if (!confirmed) return;
    try {
      await api.sources.merge(src.sourceId, destId);
      onSourceDeleted?.(src.sourceId);
      await refresh();
    } catch (err) {
      console.error('[minerva] Merge sources failed:', err);
      // No dedicated error toast yet — surface the message via the
      // confirm dialog as an informational pop, dismissable via OK.
      await onShowConfirm(
        `Merge failed: ${err instanceof Error ? err.message : String(err)}`,
        'merge-sources-error',
        'OK',
      );
    }
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

  function formatCreators(creators: string[]): string {
    if (creators.length === 0) return '';
    if (creators.length === 1) return creators[0];
    if (creators.length === 2) return `${creators[0]} and ${creators[1]}`;
    return `${creators[0]} et al.`;
  }
</script>

<div class="sources-panel">
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
            {@const who = formatCreators(s.creators)}
            <div class="source-byline">
              {#if who}{who}{/if}{#if who && s.year} · {/if}{#if s.year}<span class="year">{s.year}</span>{/if}
            </div>
          {/if}
        </button>
      {/each}
      {#if visible.length === 0}
        <div class="empty">No matches.</div>
      {/if}
    </div>
  {/if}

  {#if contextMenu}
    <div
      class="context-menu"
      bind:this={contextMenuEl}
      style:left="{contextMenu.x}px"
      style:top="{contextMenu.y}px"
    >
      <button onclick={() => handleMergeStart(contextMenu!.source)}>Merge into…</button>
      <button onclick={() => handleDelete(contextMenu!.source)}>Delete Source</button>
    </div>
  {/if}
</div>

{#if mergeSrc}
  <SourcePickerDialog
    {sources}
    title={`Merge "${mergeSrc.title ?? mergeSrc.sourceId}" into…`}
    placeholder="Pick the source to keep…"
    excludeSourceId={mergeSrc.sourceId}
    onSelect={handleMergePick}
    onCancel={() => { mergeSrc = null; }}
  />
{/if}

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
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .empty {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .filter-row {
    padding: 8px 8px 6px;
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

  /* Editorial-row treatment (§5.5). Each source reads like a
     bibliography entry: italic display-serif title, sans+mono byline.
     The 2px accent rail still marks hover/active for parity with the
     file tree. */
  .source-item {
    display: flex;
    flex-direction: column;
    width: 100%;
    text-align: left;
    padding: 10px 16px;
    background: none;
    border: none;
    border-top: 1px solid var(--border);
    border-left: 2px solid transparent;
    color: var(--text);
    cursor: pointer;
  }
  .source-list .source-item:first-child {
    border-top: none;
  }
  .source-item:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    border-left-color: var(--accent);
  }

  .source-title {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 13.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-byline {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 2px;
  }
  /* The year (and any other mono fragment in the byline) reads as a
     citation locator — switch to the mono face for tabular feel. */
  .source-byline :global(.year) {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
