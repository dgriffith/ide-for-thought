<script lang="ts">
  import { isMenuKey, openMenuAt } from './note-actions';
  /** The List layout (#1070): one row per note, its type's icon, title and summary. */
  import TypeIcon from '../TypeIcon.svelte';
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
</script>

<div class="tv-list">
  {#each view.instances as inst (inst.path)}
    {@const rt = view.rowType(inst)}
    {@const summary = view.summary(inst)}
    <button class="tv-list-row" class:selected={view.isSelected(inst.path)} aria-pressed={view.selectable ? view.isSelected(inst.path) : undefined} onclick={(e) => view.onRowClick(e, inst.path)} oncontextmenu={(e) => view.onRowContextMenu(e, inst.path)} title={inst.path} onkeydown={(e) => { if (view.rowMenu && isMenuKey(e)) { e.preventDefault(); openMenuAt(e.currentTarget); } }} data-note-path={inst.path}>
      {#if rt}<span class="tv-list-icon"><TypeIcon type={rt} size={14} /></span>{/if}
      <span class="tv-list-body">
        <span class="tv-list-title">{inst.title}</span>
        {#if summary}<span class="tv-list-summary">{summary}</span>{/if}
      </span>
    </button>
  {/each}
</div>

<style>
  .tv-list { overflow-y: auto; padding: 6px; }
  /* Icon in a left gutter, title/summary stacked beside it. `align-items:
     start` keeps the icon on the title's line rather than centred against a
     two-line row. */
  .tv-list-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .tv-list-row:hover { background: color-mix(in oklch, var(--text) 4%, transparent); }
  /* Match the title's line box so the icon centres on the first line. */
  .tv-list-icon { display: flex; align-items: center; height: 19px; flex-shrink: 0; }
  .tv-list-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .tv-list-title { font-size: 13.5px; font-weight: 500; }
  .tv-list-summary { font-size: 11.5px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Multi-selection (#2431): an accent wash, same as the sidebar's. */
  .tv-list-row.selected { background: color-mix(in oklch, var(--accent) 16%, transparent); }
</style>
