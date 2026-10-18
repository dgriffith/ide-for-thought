<script lang="ts">
  import { isMenuKey, openMenuAt } from './note-actions';
  import RemoteCover from './RemoteCover.svelte';
  /** The Gallery layout (#1070): a card per note, its cover property's image or its type's icon. */
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
  function isImageUrl(v: string | null): v is string {
    return !!v && /^https?:\/\//i.test(v);
  }
</script>

<div class="tv-gallery">
  {#each view.instances as inst (inst.path)}
    {@const rt = view.rowType(inst)}
    {@const summary = view.summary(inst)}
    <button class="tv-card" class:selected={view.isSelected(inst.path)} aria-pressed={view.selectable ? view.isSelected(inst.path) : undefined} onclick={(e) => view.onRowClick(e, inst.path)} oncontextmenu={(e) => view.onRowContextMenu(e, inst.path)} title={inst.path} onkeydown={(e) => { if (view.rowMenu && isMenuKey(e)) { e.preventDefault(); openMenuAt(e.currentTarget); } }} data-note-path={inst.path}>
      <div class="tv-card-cover">
        {#snippet icon()}<span class="tv-card-icon" style={rt?.color ? `color:${rt.color}` : undefined}>{rt?.icon ?? '◆'}</span>{/snippet}
        {#if isImageUrl(inst.cover)}
          <RemoteCover url={inst.cover} fallback={icon} />
        {:else}
          {@render icon()}
        {/if}
      </div>
      <span class="tv-card-title">{inst.title}</span>
      {#if summary}<span class="tv-card-summary">{summary}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .tv-gallery {
    overflow-y: auto;
    padding: 12px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
    align-content: start;
  }
  .tv-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0 0 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-button);
    color: var(--text);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
  }
  .tv-card:hover { border-color: var(--accent); }
  .tv-card-cover {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 3 / 2;
    background: color-mix(in oklch, var(--text) 5%, transparent);
    overflow: hidden;
  }
  .tv-card-cover img { width: 100%; height: 100%; object-fit: cover; }
  .tv-card-icon { font-size: 32px; opacity: 0.5; }
  .tv-card-title { font-size: 12.5px; font-weight: 500; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tv-card-summary { font-size: 11px; color: var(--text-faint); padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Multi-selection (#2431): an accent wash, same as the sidebar's. */
  .tv-card.selected { background: color-mix(in oklch, var(--accent) 16%, transparent); border-color: var(--accent); }
</style>
