<script lang="ts">
  import type { TagInfo, TaggedNote, TaggedSource } from '../../../shared/types';
  import { api } from '../ipc/client';
  import Chip from './ui/Chip.svelte';

  /** Tags that always render in the accent variant, no matter their
   *  count. Per IMPLEMENTATION.md §5.4 the default list is `entrypoint`
   *  and `open-question` — the two tags Minerva treats as
   *  navigationally significant. */
  const ACCENT_TAGS: ReadonlySet<string> = new Set(['entrypoint', 'open-question']);

  interface Props {
    onFileSelect: (relativePath: string) => void;
    onSourceSelect?: (sourceId: string) => void;
  }

  let { onFileSelect, onSourceSelect }: Props = $props();

  let tags = $state<TagInfo[]>([]);
  let activeTag = $state<string | null>(null);
  let taggedNotes = $state<TaggedNote[]>([]);
  let taggedSources = $state<TaggedSource[]>([]);
  let showSources = $state(true);

  /** Combined note+source count for sizing/sorting; sources can be
   *  hidden via the toggle but the chip's prominence still reflects
   *  the total tagged-thing count, which is the more useful signal. */
  function totalCount(t: TagInfo): number {
    return t.noteCount + t.sourceCount;
  }

  /** Threshold above which a chip renders with the `big` size — top
   *  quartile by frequency. Recomputed whenever the tag list changes. */
  const bigThreshold = $derived.by(() => {
    if (tags.length === 0) return Infinity;
    const sorted = tags.map(totalCount).sort((a, b) => b - a);
    const idx = Math.max(0, Math.floor(sorted.length / 4) - 1);
    return sorted[idx]!;
  });

  function chipTone(tag: string): 'accent' | 'default' {
    return ACCENT_TAGS.has(tag) ? 'accent' : 'default';
  }
  function chipSize(count: number): 'sm' | 'md' {
    return count >= bigThreshold ? 'md' : 'sm';
  }

  export async function refresh() {
    tags = await api.tags.list();
    if (activeTag) await loadForTag(activeTag);
  }

  // Fetch on mount so the panel populates whenever it's switched into,
  // not only when the host calls refresh().
  $effect(() => {
    void refresh();
  });

  export function selectTag(tag: string) {
    void showNotesForTag(tag);
  }

  async function showNotesForTag(tag: string) {
    if (activeTag === tag) {
      activeTag = null;
      taggedNotes = [];
      taggedSources = [];
      return;
    }
    activeTag = tag;
    await loadForTag(tag);
  }

  async function loadForTag(tag: string) {
    const [notes, sources] = await Promise.all([
      api.tags.notesByTag(tag),
      api.tags.sourcesByTag(tag),
    ]);
    taggedNotes = notes;
    taggedSources = sources;
  }
</script>

<div class="tag-panel">
  <div class="controls-row">
    <label class="sources-toggle" title="Include sources in tag results">
      <input type="checkbox" bind:checked={showSources} />
      <span>sources</span>
    </label>
  </div>

  {#if tags.length === 0}
    <div class="empty">No tags yet</div>
  {:else}
    <div class="tag-list">
      {#each tags as t (t.tag)}
        {@const active = activeTag === t.tag}
        {@const total = t.noteCount + t.sourceCount}
        {@const visibleCount = showSources ? total : t.noteCount}
        <Chip
          tone={active ? 'accent' : chipTone(t.tag)}
          size={chipSize(total)}
          onclick={() => showNotesForTag(t.tag)}
          title={`#${t.tag} · ${t.noteCount} note${t.noteCount === 1 ? '' : 's'}, ${t.sourceCount} source${t.sourceCount === 1 ? '' : 's'}`}
        >
          <span class="tag-name">#{t.tag}</span>
          <span class="count">{visibleCount}</span>
        </Chip>
      {/each}
    </div>
  {/if}

  {#if activeTag}
    {@const visibleSources = showSources ? taggedSources : []}
    {#if taggedNotes.length > 0 || visibleSources.length > 0}
      <div class="notes-section">
        <div class="notes-header">
          Tagged #{activeTag}
        </div>
        {#each taggedNotes as note}
          <button
            class="note-item"
            onclick={() => onFileSelect(note.relativePath)}
          >
            <span>{note.title}</span>
          </button>
        {/each}
        {#each visibleSources as source}
          <button
            class="note-item"
            onclick={() => onSourceSelect?.(source.sourceId)}
            title={`Source: ${source.sourceId}`}
          >
            <span class="kind-tag">SRC</span>
            <span>{source.title}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .tag-panel {
    flex: 1;
    overflow-y: auto;
  }

  .controls-row {
    padding: 8px 12px 6px;
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .sources-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    user-select: none;
  }

  .sources-toggle input {
    cursor: pointer;
  }

  .empty {
    padding: 8px 12px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding: 4px 14px 14px;
  }

  .tag-name {
    font-family: var(--font-sans);
  }

  .count {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 10.5px;
    color: var(--text-faint);
  }

  .notes-section {
    border-top: 1px solid var(--border);
  }

  .notes-header {
    padding: 6px 12px;
    font-size: 11px;
    color: var(--accent);
  }

  .note-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .note-item:hover {
    background: var(--bg-button);
  }

  .kind-tag {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.3px;
    padding: 1px 4px;
    border-radius: 2px;
    background: var(--bg-button);
    color: var(--text-muted);
    flex-shrink: 0;
  }
</style>
