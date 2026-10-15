<script lang="ts">
  /** The Table layout (#1070): declared properties as sortable columns (#1072). */
  import TypeIcon from '../TypeIcon.svelte';
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
  const ariaSort = (col: string) => (view.sortColumn === col ? (view.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
  import { isMenuKey, openMenuAt } from './note-actions';

  /** A focused row: Enter opens its note, the menu key opens its menu (#2776). */
  function rowKey(e: KeyboardEvent, path: string): void {
    if (!view.rowMenu || e.target !== e.currentTarget) return;
    if (isMenuKey(e)) { e.preventDefault(); openMenuAt(e.currentTarget as HTMLElement); }
    else if (e.key === 'Enter') { e.preventDefault(); view.onOpenNote(path); }
  }
  /** A focused note name in a cell (#2775): Enter, Space or the menu key open ITS menu. */
  function refKey(e: KeyboardEvent): void {
    if (!isMenuKey(e) && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.currentTarget as HTMLElement);
  }

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
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -- a row takes focus for its menu and Enter (#2776) -->
        <tr class:selected={view.isSelected(inst.path)} data-selected={view.isSelected(inst.path) || undefined} onclick={(e) => view.onRowClick(e, inst.path)} oncontextmenu={(e) => view.onRowContextMenu(e, inst.path)} title={inst.path} data-note-path={inst.path} tabindex={view.rowMenu ? 0 : undefined} onkeydown={(e) => rowKey(e, inst.path)}>
          <td class="tv-cell-title">
            <span class="tv-cell-title-inner">
              {#if rt}<TypeIcon type={rt} size={13} />{/if}
              <span>{inst.title}</span>
            </span>
          </td>
          {#each view.visibleColumns as col (col.name)}
            {@const value = inst.values[col.name] ?? null}
            {@const ref = view.refPath(col, value)}
            <td>{#if ref}<span class="tv-ref" role="button" tabindex="0" aria-haspopup="menu" data-ref-path={ref} oncontextmenu={(e) => view.onRefContextMenu(e, ref, view.display(col, value))} onkeydown={refKey}>{view.display(col, value)}</span>{:else}{view.display(col, value)}{/if}</td>
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
  /* A note named in a cell (#2775): its own right-click menu. */
  .tv-ref { text-decoration: underline dotted color-mix(in oklch, var(--text) 35%, transparent); text-underline-offset: 2px; }
</style>
