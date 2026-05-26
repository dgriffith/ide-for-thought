<script lang="ts">
  /**
   * Per-note Tables panel: extracts DuckDB table references from the
   * active note's SQL fences (```sql blocks + any `language: sql` query
   * fences). Each distinct table name becomes a clickable row that opens
   * `SELECT * FROM <name>` in a new query tab.
   *
   * Polished per IMPLEMENTATION.md §13.5: tables icon + mono name +
   * rows × cols stat in mono-faint + right-aligned SELECT * accent
   * button. Hover keeps the whole row clickable so the existing
   * one-click-to-query muscle memory still works.
   */
  import { api } from '../../ipc/client';
  import Ribbon from './Ribbon.svelte';
  import Icon from '../Icon.svelte';
  import type { TableInfo } from '../../ipc/client';

  interface Props {
    content: string;
    onOpenQuery: (sql: string) => void;
  }

  let { content, onOpenQuery }: Props = $props();

  let registeredTables = $state<Map<string, TableInfo>>(new Map());
  let search = $state('');

  async function refreshTables() {
    try {
      const list = await api.tables.list();
      registeredTables = new Map(list.map((t) => [t.name, t]));
    } catch { /* tables db not ready — keep empty map */ }
  }

  $effect(() => { void refreshTables(); });

  // Pull out SQL fences first so we don't false-positive on "FROM" in
  // prose. Matches both ```sql and the query-directive fences that
  // carry language: sql metadata.
  const sqlFenceRe = /```(?:sql|query(?:-table|-list)?)\b[^\n]*\n([\s\S]*?)```/gi;
  // Very small grammar: table name after FROM / JOIN / INTO, optionally
  // schema-qualified. Good enough for the common shapes; complex SQL
  // (CTEs with aliases, derived tables) will over-report and the
  // existence filter below sorts out the noise.
  const tableRefRe = /\b(?:FROM|JOIN|INTO)\s+("[^"]+"|`[^`]+`|[a-zA-Z_][\w.]*)/gi;

  const tables = $derived(() => {
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    sqlFenceRe.lastIndex = 0;
    while ((m = sqlFenceRe.exec(content)) !== null) {
      const body = m[1];
      tableRefRe.lastIndex = 0;
      let t: RegExpExecArray | null;
      while ((t = tableRefRe.exec(body)) !== null) {
        const raw = t[1];
        const unquoted = raw.replace(/^["`]|["`]$/g, '');
        // Strip schema prefix for display + matching — DuckDB registers
        // CSVs as bare names in the default schema.
        const bare = unquoted.split('.').pop()!;
        if (bare) seen.add(bare);
      }
    }
    const q = search.trim().toLowerCase();
    const all = [...seen].sort();
    return q ? all.filter((n) => n.toLowerCase().includes(q)) : all;
  });

  function handleSelectStar(e: MouseEvent, name: string) {
    e.stopPropagation();
    onOpenQuery(`SELECT * FROM ${name}`);
  }
</script>

<div class="tables-panel">
  <Ribbon
    {search}
    onSearch={(q: string) => { search = q; }}
    searchPlaceholder="Find table…"
  />
  <div class="scroll">
    {#if tables().length === 0}
      <div class="empty">No tables referenced</div>
    {:else}
      <div class="count">{tables().length} table{tables().length !== 1 ? 's' : ''}</div>
      {#each tables() as name}
        {@const info = registeredTables.get(name)}
        {@const known = info !== undefined}
        <button
          class="row"
          class:dead={!known}
          onclick={() => onOpenQuery(`SELECT * FROM ${name}`)}
          title={known ? `${name} · ${info.rowCount} × ${info.columns.length}` : `${name} (not registered)`}
        >
          {#if known}
            <Icon name="tables" size={14} color="var(--text-muted)" />
          {:else}
            <Icon name="warn" size={13} color="var(--rust)" />
          {/if}
          <span class="name-col">
            <span class="name">{name}</span>
            {#if known}
              <span class="stat">{info.rowCount} × {info.columns.length}</span>
            {:else}
              <span class="stat dead-stat">not registered</span>
            {/if}
          </span>
          {#if known}
            <button
              class="select-btn"
              onclick={(e) => handleSelectStar(e, name)}
              title="SELECT * FROM {name}"
            >SELECT *</button>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .tables-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .count {
    padding: 6px 12px 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.04em;
  }

  /* Row (§13.5) — icon + (name + stat stacked) + right-aligned SELECT *
     accent button. The whole row stays a button so a casual click still
     fires the query — the explicit SELECT * pill is just an affordance
     to make the action discoverable. */
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-left: 2px solid transparent;
    background: none;
    color: var(--text);
    font-family: var(--font-sans);
    cursor: pointer;
    text-align: left;
  }
  .row:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    border-left-color: var(--accent);
  }
  .row.dead {
    cursor: default;
  }
  .row.dead:hover {
    border-left-color: transparent;
  }

  .name-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .name {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.dead .name { color: var(--rust); }
  .stat {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .dead-stat { color: var(--rust); }

  /* SELECT * accent pill. Stops propagation so a click on the pill
     doesn't double-trigger the row's onclick. */
  .select-btn {
    padding: 3px 8px;
    border: 1px solid color-mix(in oklch, var(--accent) 30%, transparent);
    border-radius: 4px;
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .row:hover .select-btn {
    opacity: 1;
  }
  .select-btn:hover {
    background: color-mix(in oklch, var(--accent) 22%, transparent);
  }

  .empty {
    padding: 12px;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
