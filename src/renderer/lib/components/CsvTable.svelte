<script lang="ts">
  import { parseCsv } from '../../../shared/csv-parse';

  interface Props {
    relativePath: string;
    content: string;
  }

  let { relativePath, content }: Props = $props();

  // Keep the render cost bounded; the rest stays indexed and queryable.
  const ROW_LIMIT = 10000;

  const parsed = $derived(parseCsv(content));
  const totalRows = $derived(parsed.rows.length);
  const visibleRows = $derived(totalRows > ROW_LIMIT ? parsed.rows.slice(0, ROW_LIMIT) : parsed.rows);
  const truncated = $derived(totalRows > ROW_LIMIT);
</script>

<div class="csv-container">
  <div class="meta">
    <span class="path">{relativePath}</span>
    <span class="counts">
      {totalRows.toLocaleString()} row{totalRows === 1 ? '' : 's'}
      &times;
      {parsed.headers.length} column{parsed.headers.length === 1 ? '' : 's'}
    </span>
  </div>

  {#if parsed.headers.length === 0}
    <div class="empty">Empty CSV.</div>
  {:else}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            {#each parsed.headers as header (header)}
              <th>{header}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each visibleRows as row, ri (ri)}
            <tr>
              {#each row as cell, ci (ci)}
                <td class:empty-cell={!cell}>
                  {#if cell}{cell}{:else}\u2014{/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if truncated}
      <div class="truncation-note">
        Showing first {ROW_LIMIT.toLocaleString()} of {totalRows.toLocaleString()} rows. The full file remains indexed and SPARQL-queryable.
      </div>
    {/if}
  {/if}
</div>

<style>
  .csv-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .meta {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 6px 12px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    color: var(--titlebar-text-muted);
    flex-shrink: 0;
  }

  .path {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--titlebar-text);
  }

  .table-scroll {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  table {
    border-collapse: collapse;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
    min-width: 100%;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg-button);
    color: var(--text);
    text-align: left;
    font-weight: 600;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
    white-space: nowrap;
  }

  tbody td {
    padding: 5px 10px;
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
    color: var(--text);
    white-space: nowrap;
    vertical-align: top;
  }

  tbody tr:nth-child(even) td {
    background: var(--bg-sidebar);
  }

  .empty-cell {
    color: var(--text-muted);
  }

  .empty {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }

  .truncation-note {
    padding: 6px 12px;
    background: var(--bg-titlebar);
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--text-muted);
    text-align: center;
    flex-shrink: 0;
  }
</style>
