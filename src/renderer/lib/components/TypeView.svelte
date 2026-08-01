<script lang="ts">
  /**
   * Multi-view over all instances of a typed-object type (#1070) — the same
   * typed notes rendered as a list, a table (declared properties as columns), or
   * a gallery of cards keyed off a designated cover property. "Switch the view,
   * same data": every projection reads the one `api.types.instances(typeId)`
   * result, so toggling never re-queries the instance set.
   *
   * Projection state (layout / sort / visible columns) is PROP-DRIVEN: it lives
   * on the tab (persisted across sessions) and is mutated via `onStateChange`,
   * so a saved view (#1072) restores it exactly and "Save view" can capture it.
   *
   * A read-only surface: rows/cards deep-link to the note (the property form
   * #1066 is where values are edited); table cells never mutate the graph.
   */
  import { api } from '../ipc/client';
  import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../shared/objects/type-def';

  type Layout = 'list' | 'table' | 'gallery';
  interface StatePatch { layout?: Layout; sortColumn?: string | null; sortDir?: 'asc' | 'desc'; columns?: string[] | null }

  interface Props {
    typeId: string;
    layout: Layout;
    /** Sort key (property name, `__title`, or null) + direction — from the tab. */
    sortColumn: string | null;
    sortDir: 'asc' | 'desc';
    /** Visible property names (table); null = every declared column. */
    columns: string[] | null;
    /** Bumped by the host on write/reindex so the view re-projects (#1070). */
    revision: number;
    onStateChange: (patch: StatePatch) => void;
    onOpenNote: (relativePath: string) => void;
    /** Save the current projection as a named view (#1072); omitted when unavailable. */
    onSaveView?: () => void;
  }
  let { typeId, layout, sortColumn, sortDir, columns, revision, onStateChange, onOpenNote, onSaveView }: Props = $props();

  let type = $state<TypeInfo | null>(null);
  let instances = $state<TypeInstanceRow[]>([]);
  let loading = $state(true);
  let columnsMenuOpen = $state(false);

  async function load(): Promise<void> {
    loading = true;
    const result = await api.types.instances(typeId);
    type = result.type;
    instances = result.instances;
    loading = false;
  }
  // Re-project when the type changes or the graph is rewritten.
  $effect(() => { typeId; revision; void load(); });

  const allColumns = $derived<PropertyDef[]>(type?.properties ?? []);
  // Visible columns (table): null on the tab means "all". Order follows the
  // type's declared order regardless of the saved set.
  const visibleColumns = $derived<PropertyDef[]>(
    columns === null ? allColumns : allColumns.filter((c) => columns.includes(c.name)),
  );

  function isVisible(name: string): boolean {
    return columns === null || columns.includes(name);
  }
  function toggleColumn(name: string): void {
    const all = allColumns.map((c) => c.name);
    const cur = new Set(columns ?? all);
    if (cur.has(name)) cur.delete(name); else cur.add(name);
    const next = all.filter((n) => cur.has(n));
    onStateChange({ columns: next.length === all.length ? null : next });
  }

  function display(prop: PropertyDef, value: string | null): string {
    if (value === null || value === '') return '—';
    if (prop.type === 'link-to-type') {
      const tail = value.split(/[/#]/).pop() ?? value;
      try { return decodeURIComponent(tail); } catch { return tail; }
    }
    return value;
  }

  function summary(inst: TypeInstanceRow): string {
    for (const col of allColumns) {
      const v = inst.values[col.name];
      if (v) return `${col.label ?? col.name}: ${display(col, v)}`;
    }
    return '';
  }

  function toggleSort(col: string): void {
    if (sortColumn === col) onStateChange({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' });
    else onStateChange({ sortColumn: col, sortDir: 'asc' });
  }

  function cellFor(inst: TypeInstanceRow, col: string): string | null {
    return col === '__title' ? inst.title : inst.values[col] ?? null;
  }

  const sorted = $derived.by<TypeInstanceRow[]>(() => {
    if (!sortColumn) return instances;
    const col = sortColumn;
    const numeric = col !== '__title' && allColumns.find((c) => c.name === col)?.type === 'number';
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...instances].sort((a, b) => {
      const av = cellFor(a, col);
      const bv = cellFor(b, col);
      if (av === null || av === '') return bv === null || bv === '' ? 0 : 1;
      if (bv === null || bv === '') return -1;
      const cmp = numeric
        ? Number(av) - Number(bv)
        : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return cmp * dir;
    });
  });

  function isImageUrl(v: string | null): v is string {
    return !!v && /^https?:\/\//i.test(v);
  }

  const LAYOUTS: { id: Layout; label: string }[] = [
    { id: 'list', label: 'List' },
    { id: 'table', label: 'Table' },
    { id: 'gallery', label: 'Gallery' },
  ];
</script>

<div class="type-view">
  <header class="tv-header">
    <span class="tv-icon" style={type?.color ? `color:${type.color}` : undefined}>{type?.icon ?? '◆'}</span>
    <h1 class="tv-title">{type?.label ?? typeId}</h1>
    <span class="tv-count">{instances.length}</span>

    <div class="tv-actions">
      {#if layout === 'table' && allColumns.length > 0}
        <div class="tv-columns">
          <button class="tv-btn" aria-expanded={columnsMenuOpen} onclick={() => (columnsMenuOpen = !columnsMenuOpen)}>Columns ▾</button>
          {#if columnsMenuOpen}
            <div class="tv-columns-menu" role="menu">
              {#each allColumns as col (col.name)}
                <label>
                  <input type="checkbox" checked={isVisible(col.name)} onchange={() => toggleColumn(col.name)} />
                  {col.label ?? col.name}
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      {#if onSaveView}
        <button class="tv-btn" onclick={() => onSaveView?.()}>Save view</button>
      {/if}
      <div class="tv-switch" role="tablist" aria-label="View">
        {#each LAYOUTS as l (l.id)}
          <button
            role="tab"
            aria-selected={layout === l.id}
            class:active={layout === l.id}
            onclick={() => onStateChange({ layout: l.id })}
          >{l.label}</button>
        {/each}
      </div>
    </div>
  </header>

  {#if loading}
    <p class="tv-empty">Loading…</p>
  {:else if !type}
    <p class="tv-empty">This type is no longer defined.</p>
  {:else if instances.length === 0}
    <p class="tv-empty">No {type.label.toLowerCase()} instances yet.</p>
  {:else if layout === 'list'}
    <div class="tv-list">
      {#each instances as inst (inst.path)}
        <button class="tv-list-row" onclick={() => onOpenNote(inst.path)} title={inst.path}>
          <span class="tv-list-title">{inst.title}</span>
          {#if summary(inst)}<span class="tv-list-summary">{summary(inst)}</span>{/if}
        </button>
      {/each}
    </div>
  {:else if layout === 'table'}
    <div class="tv-table-scroll">
      <table class="tv-table">
        <thead>
          <tr>
            <th
              class="sortable"
              class:sorted={sortColumn === '__title'}
              aria-sort={sortColumn === '__title' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              onclick={() => toggleSort('__title')}
            >Title{#if sortColumn === '__title'}<span class="arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>{/if}</th>
            {#each visibleColumns as col (col.name)}
              <th
                class="sortable"
                class:sorted={sortColumn === col.name}
                aria-sort={sortColumn === col.name ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                onclick={() => toggleSort(col.name)}
              >{col.label ?? col.name}{#if sortColumn === col.name}<span class="arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>{/if}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each sorted as inst (inst.path)}
            <tr onclick={() => onOpenNote(inst.path)} title={inst.path}>
              <td class="tv-cell-title">{inst.title}</td>
              {#each visibleColumns as col (col.name)}
                <td>{display(col, inst.values[col.name] ?? null)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="tv-gallery">
      {#each instances as inst (inst.path)}
        <button class="tv-card" onclick={() => onOpenNote(inst.path)} title={inst.path}>
          <div class="tv-card-cover">
            {#if isImageUrl(inst.cover)}
              <img src={inst.cover} alt="" loading="lazy" />
            {:else}
              <span class="tv-card-icon" style={type.color ? `color:${type.color}` : undefined}>{type.icon ?? '◆'}</span>
            {/if}
          </div>
          <span class="tv-card-title">{inst.title}</span>
          {#if summary(inst)}<span class="tv-card-summary">{summary(inst)}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .type-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .tv-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .tv-icon { font-size: 18px; line-height: 1; }
  .tv-title { font-size: 15px; font-weight: 600; margin: 0; color: var(--text); }
  .tv-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .tv-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .tv-btn {
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-button);
    color: var(--text-muted);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .tv-btn:hover { color: var(--text); border-color: var(--accent); }
  .tv-columns { position: relative; }
  .tv-columns-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 150px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-elevated, var(--bg));
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }
  .tv-columns-menu label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    border-radius: 4px;
  }
  .tv-columns-menu label:hover { background: color-mix(in oklch, var(--text) 5%, transparent); }
  .tv-switch { display: flex; gap: 0; }
  .tv-switch button {
    padding: 3px 10px;
    border: 1px solid var(--border);
    background: var(--bg-button);
    color: var(--text-muted);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .tv-switch button:first-child { border-radius: 5px 0 0 5px; }
  .tv-switch button:last-child { border-radius: 0 5px 5px 0; }
  .tv-switch button:not(:first-child) { border-left: none; }
  .tv-switch button.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .tv-empty { padding: 24px 16px; color: var(--text-faint); font-size: 13px; }

  /* List */
  .tv-list { overflow-y: auto; padding: 6px; }
  .tv-list-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
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
  .tv-list-title { font-size: 13.5px; font-weight: 500; }
  .tv-list-summary { font-size: 11.5px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Table */
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

  /* Gallery */
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
</style>
