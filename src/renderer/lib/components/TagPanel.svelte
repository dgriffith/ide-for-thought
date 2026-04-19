<script lang="ts">
  import type { TagInfo, TaggedNote, TaggedSource } from '../../../shared/types';
  import { api } from '../ipc/client';

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

  export async function refresh() {
    tags = await api.tags.list();
    if (activeTag) await loadForTag(activeTag);
  }

  export function selectTag(tag: string) {
    showNotesForTag(tag);
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
  <div class="panel-header">
    <span>Tags</span>
    <label class="sources-toggle" title="Include sources in tag results">
      <input type="checkbox" bind:checked={showSources} />
      <span>sources</span>
    </label>
  </div>

  {#if tags.length === 0}
    <div class="empty">No tags yet</div>
  {:else}
    <div class="tag-list">
      {#each tags as { tag, count }}
        <button
          class="tag-item"
          class:active={activeTag === tag}
          onclick={() => showNotesForTag(tag)}
        >
          <span class="tag-name">#{tag}</span>
          <span class="tag-count">{count}</span>
        </button>
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
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    max-height: 50%;
    overflow-y: auto;
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
    justify-content: space-between;
  }

  .sources-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 400;
    text-transform: lowercase;
    letter-spacing: 0;
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
    gap: 4px;
    padding: 0 8px 8px;
  }

  .tag-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .tag-item:hover {
    background: var(--bg-button);
    color: var(--text);
  }

  .tag-item.active {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }

  .tag-count {
    font-size: 10px;
    opacity: 0.7;
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
