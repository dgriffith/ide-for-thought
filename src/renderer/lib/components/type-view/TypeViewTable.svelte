<script lang="ts">
  /** The Table layout (#1070): declared properties as sortable columns (#1072). */
  import TypeIcon from '../TypeIcon.svelte';
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
  const ariaSort = (col: string) => (view.sortColumn === col ? (view.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
</script>

<div class="tv-table-scroll">
  <table class="tv-table">
    <thead>
      <tr>
        <th
          class="sortable"
          class:sorted={view.sortColumn === '__title'}
          aria-sort={ariaSort('__title')}
          onclick={() => view.toggleSort('__title')}
        >Title{#if view.sortColumn === '__title'}<span class="arrow">{view.sortDir === 'asc' ? '▲' : '▼'}</span>{/if}</th>
        {#each view.visibleColumns as col (col.name)}
          <th
            class="sortable"
            class:sorted={view.sortColumn === col.name}
            aria-sort={ariaSort(col.name)}
            onclick={() => view.toggleSort(col.name)}
          >{col.label ?? col.name}{#if view.sortColumn === col.name}<span class="arrow">{view.sortDir === 'asc' ? '▲' : '▼'}</span>{/if}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each view.sorted as inst (inst.path)}
        {@const rt = view.rowType(inst)}
        <tr class:selected={view.isSelected(inst.path)} data-selected={view.isSelected(inst.path) || undefined} onclick={(e) => view.onRowClick(e, inst.path)} oncontextmenu={(e) => view.onRowContextMenu(e, inst.path)} title={inst.path} data-note-path={inst.path}>
          <td class="tv-cell-title">
            <span class="tv-cell-title-inner">
              {#if rt}<TypeIcon type={rt} size={13} />{/if}
              <span>{inst.title}</span>
            </span>
          </td>
          {#each view.visibleColumns as col (col.name)}
            <td>{view.display(col, inst.values[col.name] ?? null)}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .tv-table-scroll { overflow: auto; padding: 4px; }
  .tv-table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  .tv-table th, .tv-table td {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .tv-table th {
    position: sticky;
    top: 0;
    background: var(--bg);
    color: var(--text-muted);
    font-weight: 600;
    user-select: none;
  }
  .tv-table th.sortable { cursor: pointer; }
  .tv-table th.sortable:hover { color: var(--text); }
  .tv-table th.sorted { color: var(--text); }
  .arrow { margin-left: 4px; font-size: 8px; }
  .tv-table tbody tr { cursor: pointer; }
  .tv-table tbody tr:hover { background: color-mix(in oklch, var(--text) 4%, transparent); }
  .tv-cell-title { font-weight: 500; color: var(--text); }
  .tv-cell-title-inner { display: flex; align-items: center; gap: 7px; }
  /* Multi-selection (#2431): an accent wash, same as the sidebar's. */
  .tv-table tbody tr.selected { background: color-mix(in oklch, var(--accent) 16%, transparent); }
</style>
