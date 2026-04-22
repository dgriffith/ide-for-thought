<script lang="ts">
  import { api } from '../ipc/client';
  import type { TableInfo } from '../ipc/client';

  interface Props {
    onTableClick: (tableName: string) => void;
    onOpenCsv: (relativePath: string) => void;
  }

  let { onTableClick, onOpenCsv }: Props = $props();

  let tables = $state<TableInfo[]>([]);
  let filter = $state('');
  let collapsed = $state(false);
  let contextMenu = $state<{ x: number; y: number; table: TableInfo } | null>(null);

  export async function refresh(): Promise<void> {
    tables = await api.tables.list();
  }

  let visible = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) =>
      t.name.toLowerCase().includes(q) || t.relativePath.toLowerCase().includes(q),
    );
  });

  function handleContextMenu(e: MouseEvent, table: TableInfo) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, table };
    const close = () => {
      contextMenu = null;
      window.removeEventListener('click', close);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
  }
</script>

<div class="tables-panel">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="panel-header" onclick={() => { collapsed = !collapsed; }}>
    <span class="chevron" class:collapsed>▾</span>
    <span>Tables</span>
    <span class="count">{tables.length}</span>
  </div>

  {#if !collapsed}
    {#if tables.length === 0}
      <div class="empty">No tables yet. Drop a CSV into the thoughtbase.</div>
    {:else}
      <div class="filter-row">
        <input
          type="text"
          class="filter-input"
          placeholder="Filter tables…"
          bind:value={filter}
        />
      </div>
      <div class="table-list">
        {#each visible as t (t.name)}
          <button
            class="table-item"
            onclick={() => onTableClick(t.name)}
            oncontextmenu={(e) => handleContextMenu(e, t)}
            title={t.relativePath}
          >
            <div class="table-name">{t.name}</div>
            <div class="table-meta">{t.rowCount} {t.rowCount === 1 ? 'row' : 'rows'} · {t.columns.length} {t.columns.length === 1 ? 'col' : 'cols'}</div>
          </button>
        {/each}
        {#if visible.length === 0}
          <div class="empty">No matches.</div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

{#if contextMenu}
  <div
    class="context-menu"
    style:left="{contextMenu.x}px"
    style:top="{contextMenu.y}px"
  >
    <button onclick={() => { onTableClick(contextMenu!.table.name); contextMenu = null; }}>
      Query (SELECT *)
    </button>
    <button onclick={() => { navigator.clipboard.writeText(contextMenu!.table.name); contextMenu = null; }}>
      Copy Table Name
    </button>
    <div class="separator"></div>
    <button onclick={() => { onOpenCsv(contextMenu!.table.relativePath); contextMenu = null; }}>
      Open CSV
    </button>
    <button onclick={() => { api.shell.revealFile(contextMenu!.table.relativePath); contextMenu = null; }}>
      Reveal in Finder
    </button>
  </div>
{/if}

<style>
  .tables-panel {
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

  .table-list {
    flex: 1;
    overflow-y: auto;
    padding-bottom: 6px;
  }

  .table-item {
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
  .table-item:hover {
    background: var(--bg-button);
    border-left-color: var(--accent);
  }

  .table-name {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .table-meta {
    font-size: 10px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 1px;
  }

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

  .context-menu button:hover {
    background: var(--bg-button);
  }

  .separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
</style>
