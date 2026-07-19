<script lang="ts">
  /**
   * Per-note Tables panel — two sections (user request):
   *  - **Referenced**: DuckDB tables the note's SQL fences read (```sql blocks +
   *    any `language: sql` query fences), parsed from the body via
   *    `extractReferencedTableNames`. May point at tables defined elsewhere or
   *    at names that aren't registered.
   *  - **Defined in this note**: tables materialized from *this* note's
   *    captioned markdown tables (#1356–#1360) — registered tables whose
   *    `source === 'note'` and `relativePath` is the active note.
   *
   * A table the note both defines and queries appears in both sections (they
   * answer different questions). Each row opens `SELECT * FROM <name>` in a new
   * query tab.
   *
   * Polished per IMPLEMENTATION.md §13.5: tables icon + mono name + rows × cols
   * stat in mono-faint + right-aligned SELECT * accent button.
   */
  import { api } from '../../ipc/client';
  import Ribbon from './Ribbon.svelte';
  import Icon from '../Icon.svelte';
  import type { TableInfo } from '../../ipc/client';
  import { partitionTables } from './tables-panel-logic';

  interface Props {
    content: string;
    activeFilePath: string | null;
    /** Bumped by the sidebar's refresh() on save/auto-save — re-lists tables so
     *  the Defined section reflects newly registered / dropped note tables. */
    revision: number;
    onOpenQuery: (sql: string) => void;
  }

  let { content, activeFilePath, revision, onOpenQuery }: Props = $props();

  let registered = $state<TableInfo[]>([]);
  let search = $state('');

  async function refreshTables() {
    try {
      registered = await api.tables.list();
    } catch { /* tables db not ready — keep empty list */ }
  }

  // Re-list on mount and whenever `revision` bumps (a save may have registered
  // or dropped this note's tables).
  $effect(() => { void revision; void refreshTables(); });

  const parts = $derived(partitionTables(content, registered, activeFilePath, search));
  const total = $derived(parts.defined.length + parts.referenced.length);

  function handleSelectStar(e: MouseEvent, name: string) {
    e.stopPropagation();
    onOpenQuery(`SELECT * FROM ${name}`);
  }
</script>

<!-- A div, not a button: the row carries an inner "SELECT *" button, and a
     button can't contain a button. role/tabindex/onkeydown keep it
     keyboard-accessible. `info` is the registered table, or undefined for a
     referenced name that isn't a live DuckDB table. -->
{#snippet tableRow(name: string, info: TableInfo | undefined, caption: string | undefined)}
  <div
    class="row"
    class:dead={info === undefined}
    role="button"
    tabindex="0"
    onclick={() => onOpenQuery(`SELECT * FROM ${name}`)}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenQuery(`SELECT * FROM ${name}`); } }}
    title={info
      ? `${caption ? `${caption} · ` : ''}${name} · ${info.rowCount} × ${info.columns.length}`
      : `${name} (not registered)`}
  >
    {#if info}
      <Icon name="tables" size={14} color="var(--text-muted)" />
    {:else}
      <Icon name="warn" size={13} color="var(--rust)" />
    {/if}
    <span class="name-col">
      <span class="name">{name}</span>
      {#if info}
        <span class="stat">{info.rowCount} × {info.columns.length}</span>
      {:else}
        <span class="stat dead-stat">not registered</span>
      {/if}
    </span>
    {#if info}
      <button
        class="select-btn"
        onclick={(e) => handleSelectStar(e, name)}
        title="SELECT * FROM {name}"
      >SELECT *</button>
    {/if}
  </div>
{/snippet}

<div class="tables-panel">
  <Ribbon
    {search}
    onSearch={(q: string) => { search = q; }}
    searchPlaceholder="Find table…"
  />
  <div class="scroll">
    {#if total === 0}
      <div class="empty">No tables</div>
    {:else}
      {#if parts.referenced.length > 0}
        <div class="section-header">Referenced · {parts.referenced.length}</div>
        {#each parts.referenced as r (r.name)}
          {@render tableRow(r.name, r.info, undefined)}
        {/each}
      {/if}
      {#if parts.defined.length > 0}
        <div class="section-header">Defined in this note · {parts.defined.length}</div>
        {#each parts.defined as t (t.name)}
          {@render tableRow(t.name, t, t.caption)}
        {/each}
      {/if}
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
  /* Section label above each group (Referenced / Defined in this note). The
     first sits flush; later ones get a top rule + spacing to separate groups. */
  .section-header {
    padding: 6px 12px 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.04em;
  }
  .section-header ~ .section-header {
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
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
  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
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
