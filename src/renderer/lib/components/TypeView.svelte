<script lang="ts">
  /**
   * Multi-view over all instances of a typed-object type (#1070) — the same
   * typed notes rendered as a list, a table (declared properties as columns), or
   * a gallery of cards keyed off a designated cover property. "Switch the view,
   * same data": every projection reads the one `api.types.instances(typeId)`
   * result, so toggling never re-queries the instance set.
   *
   * A read-only surface: rows/cards deep-link to the note (the property form
   * #1066 is where values are edited); table cells never mutate the graph.
   */
  import { api } from '../ipc/client';
  import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../shared/objects/type-def';

  type Layout = 'list' | 'table' | 'gallery';

  interface Props {
    typeId: string;
    layout: Layout;
    /** Bumped by the host on write/reindex so the view re-projects (#1070). */
    revision: number;
    onLayoutChange: (layout: Layout) => void;
    onOpenNote: (relativePath: string) => void;
  }
  let { typeId, layout, revision, onLayoutChange, onOpenNote }: Props = $props();

  let type = $state<TypeInfo | null>(null);
  let instances = $state<TypeInstanceRow[]>([]);
  let loading = $state(true);

  // Sort state (table view). `null` column = the intrinsic title/path order the
  // projection already returns.
  let sortCol = $state<string | null>(null);
  let sortDir = $state<'asc' | 'desc'>('asc');

  async function load(): Promise<void> {
    loading = true;
    const result = await api.types.instances(typeId);
    type = result.type;
    instances = result.instances;
    loading = false;
  }

  // Re-project when the type changes or the graph is rewritten.
  $effect(() => { typeId; revision; void load(); });

  const columns = $derived<PropertyDef[]>(type?.properties ?? []);

  /** Human-readable cell value: link-to-type IRIs collapse to their tail; other
   *  types show their lexical string; null → an em dash. */
  function display(prop: PropertyDef, value: string | null): string {
    if (value === null || value === '') return '—';
    if (prop.type === 'link-to-type') {
      const tail = value.split(/[/#]/).pop() ?? value;
      try { return decodeURIComponent(tail); } catch { return tail; }
    }
    return value;
  }

  /** First non-empty declared-property value — the list row's summary line. */
  function summary(inst: TypeInstanceRow): string {
    for (const col of columns) {
      const v = inst.values[col.name];
      if (v) return `${col.label ?? col.name}: ${display(col, v)}`;
    }
    return '';
  }

  function toggleSort(col: string): void {
    if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortCol = col; sortDir = 'asc'; }
  }

  function cellFor(inst: TypeInstanceRow, col: string): string | null {
    return col === '__title' ? inst.title : inst.values[col] ?? null;
  }

  const sorted = $derived.by<TypeInstanceRow[]>(() => {
    if (!sortCol) return instances;
    const col = sortCol;
    const numeric = col !== '__title' && columns.find((c) => c.name === col)?.type === 'number';
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...instances].sort((a, b) => {
      const av = cellFor(a, col);
      const bv = cellFor(b, col);
      // Empty values always sort last, regardless of direction.
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
    <div class="tv-switch" role="tablist" aria-label="View">
      {#each LAYOUTS as l (l.id)}
        <button
          role="tab"
          aria-selected={layout === l.id}
          class:active={layout === l.id}
          onclick={() => onLayoutChange(l.id)}
        >{l.label}</button>
      {/each}
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
              class:sorted={sortCol === '__title'}
              aria-sort={sortCol === '__title' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              onclick={() => toggleSort('__title')}
            >Title{#if sortCol === '__title'}<span class="arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>{/if}</th>
            {#each columns as col (col.name)}
              <th
                class="sortable"
                class:sorted={sortCol === col.name}
                aria-sort={sortCol === col.name ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                onclick={() => toggleSort(col.name)}
              >{col.label ?? col.name}{#if sortCol === col.name}<span class="arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>{/if}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each sorted as inst (inst.path)}
            <tr onclick={() => onOpenNote(inst.path)} title={inst.path}>
              <td class="tv-cell-title">{inst.title}</td>
              {#each columns as col (col.name)}
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
  .tv-switch { margin-left: auto; display: flex; gap: 2px; }
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
