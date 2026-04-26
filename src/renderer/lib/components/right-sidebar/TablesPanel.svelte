<script lang="ts">
  /**
   * Per-note Tables panel: extracts DuckDB table references from the
   * active note's SQL fences (```sql blocks + any `language: sql` query
   * fences). Each distinct table name becomes a clickable row that opens
   * `SELECT * FROM <name>` in a new query tab.
   *
   * Names we couldn't match against a registered table are shown dimmed
   * (mirrors OutgoingLinksPanel's "dead link" styling) so it's clear
   * when a fence references a table the CSV watcher hasn't picked up.
   */
  import { api } from '../../ipc/client';
  import type { TableInfo } from '../../ipc/client';
  import Ribbon from './Ribbon.svelte';

  interface Props {
    content: string;
    onOpenQuery: (sql: string) => void;
  }

  let { content, onOpenQuery }: Props = $props();

  let registeredTables = $state<Set<string>>(new Set());
  let search = $state('');

  async function refreshTables() {
    try {
      const list = await api.tables.list() as TableInfo[];
      registeredTables = new Set(list.map((t) => t.name));
    } catch { /* tables db not ready — keep empty set */ }
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
</script>

<div class="tables-panel">
  <Ribbon
    {search}
    onSearch={(q) => { search = q; }}
    searchPlaceholder="Find table…"
  />
  <div class="scroll">
    {#if tables().length === 0}
      <div class="empty">No tables referenced</div>
    {:else}
      <div class="count">{tables().length} table{tables().length !== 1 ? 's' : ''}</div>
      {#each tables() as name}
        {@const known = registeredTables.has(name)}
        <button
          class="row"
          class:dead={!known}
          onclick={() => onOpenQuery(`SELECT * FROM ${name}`)}
          title={known ? name : `${name} (not registered)`}
        >
          <span class="name">{name}</span>
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
    padding: 4px 12px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .row {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 3px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-mono, monospace);
  }
  .row:hover { background: var(--bg-button); }
  .row.dead { opacity: 0.4; font-style: italic; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center; }
</style>
