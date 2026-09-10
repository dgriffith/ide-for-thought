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
  import TypeIcon from './TypeIcon.svelte';
  import TypeViewMap from './TypeViewMap.svelte';
  import { objectTypesStore } from '../stores/object-types.svelte';
  import { outputToMarkdownClipboard } from '../preview/compute-output-render';
  import { stripNoteExt } from '../../../shared/note-extensions';
  import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../shared/objects/type-def';

  type Layout = 'list' | 'table' | 'gallery' | 'map';
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
    /** Suppress the title/count/toolbar header — for an inline note embed
     *  (#2067), which has no host to mutate layout/sort/columns state and
     *  provides its own surrounding context. Defaults to the full-pane tab
     *  chrome everywhere else. */
    chromeless?: boolean;
  }
  let { typeId, layout, sortColumn, sortDir, columns, revision, onStateChange, onOpenNote, onSaveView, chromeless = false }: Props = $props();

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

  /** Same link-to-type decoding as `display()`, but '' (not '—') for a
   *  missing value — '—' is a UI placeholder; the compute-cell markdown-copy
   *  precedent this matches (`outputToMarkdownClipboard`) uses an empty cell
   *  for a null value. */
  function copyValue(prop: PropertyDef, value: string | null): string {
    if (value === null || value === '') return '';
    if (prop.type === 'link-to-type') {
      const tail = value.split(/[/#]/).pop() ?? value;
      try { return decodeURIComponent(tail); } catch { return tail; }
    }
    return value;
  }

  /**
   * "Copy as markdown" (#2068) — a stateless OS side-effect
   * (`navigator.clipboard`), so it's called directly rather than routed
   * through a store per CLAUDE.md's renderer data-flow rule. Table reuses
   * the exact compute-cell markdown-table serializer (`outputToMarkdownClipboard`)
   * so a user never sees two different "markdown table" conventions in the
   * same app; list/gallery/map have no literal tabular/grid markdown
   * representation, so they all fall back to the same wiki-linked bullet
   * list — the same title + summary already shown on screen for those
   * layouts, just as `- [[note]] — summary` lines. Respects the table's
   * current sort/visible-columns (list/gallery/map have no sort or filter
   * to respect — sorting is table-only, per this view's own docs above).
   */
  function copyAsMarkdown(): void {
    let md: string;
    if (layout === 'table') {
      const cols = ['Title', ...visibleColumns.map((c) => c.label ?? c.name)];
      const rows = sorted.map((inst) => [
        inst.title,
        ...visibleColumns.map((c) => copyValue(c, inst.values[c.name] ?? null)),
      ]);
      md = outputToMarkdownClipboard({ type: 'table', columns: cols, rows });
    } else {
      md = instances.map((inst) => {
        const link = `[[${stripNoteExt(inst.path)}]]`;
        const s = summary(inst);
        return s ? `- ${link} — ${s}` : `- ${link}`;
      }).join('\n');
    }
    void navigator.clipboard.writeText(md);
  }

  function isImageUrl(v: string | null): v is string {
    return !!v && /^https?:\/\//i.test(v);
  }

  /**
   * The icon for one row. This view is subclass-aware (#1587) — a Book view
   * lists Novels too — so a row shows its OWN type's icon, not the view's.
   * That makes the per-row icon informative rather than merely repeating the
   * header. Falls back to the view's type if the map hasn't loaded yet.
   */
  function rowType(inst: TypeInstanceRow): TypeInfo | null {
    return objectTypesStore.typeForNote(inst.path) ?? type;
  }

  // #2066: Map only appears for a type that actually has a location-shaped
  // (geo) property — not a menu item that's always present but broken for
  // Book/Person/etc. Mirrors PropertiesPanel.svelte's existing `pd.type === 'x'`
  // gating precedent, not `cover`'s ungated "any property name" one.
  const locationProperty = $derived<string | null>(allColumns.find((c) => c.type === 'geo')?.name ?? null);
  const LAYOUTS = $derived<{ id: Layout; label: string }[]>([
    { id: 'list', label: 'List' },
    { id: 'table', label: 'Table' },
    { id: 'gallery', label: 'Gallery' },
    ...(locationProperty ? [{ id: 'map' as const, label: 'Map' }] : []),
  ]);
</script>

<div class="type-view">
  {#if !chromeless}
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
        <button class="tv-btn" onclick={copyAsMarkdown}>Copy as markdown</button>
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
  {/if}

  {#if loading}
    <p class="tv-empty">Loading…</p>
  {:else if !type}
    <p class="tv-empty">This type is no longer defined.</p>
  {:else if instances.length === 0}
    <p class="tv-empty">No {type.label.toLowerCase()} instances yet.</p>
  {:else if layout === 'list'}
    <div class="tv-list">
      {#each instances as inst (inst.path)}
        {@const rt = rowType(inst)}
        <button class="tv-list-row" onclick={() => onOpenNote(inst.path)} title={inst.path}>
          {#if rt}<span class="tv-list-icon"><TypeIcon type={rt} size={14} /></span>{/if}
          <span class="tv-list-body">
            <span class="tv-list-title">{inst.title}</span>
            {#if summary(inst)}<span class="tv-list-summary">{summary(inst)}</span>{/if}
          </span>
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
            {@const rt = rowType(inst)}
            <tr onclick={() => onOpenNote(inst.path)} title={inst.path}>
              <td class="tv-cell-title">
                <span class="tv-cell-title-inner">
                  {#if rt}<TypeIcon type={rt} size={13} />{/if}
                  <span>{inst.title}</span>
                </span>
              </td>
              {#each visibleColumns as col (col.name)}
                <td>{display(col, inst.values[col.name] ?? null)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if layout === 'gallery'}
    <div class="tv-gallery">
      {#each instances as inst (inst.path)}
        {@const rt = rowType(inst)}
        <button class="tv-card" onclick={() => onOpenNote(inst.path)} title={inst.path}>
          <div class="tv-card-cover">
            {#if isImageUrl(inst.cover)}
              <img src={inst.cover} alt="" loading="lazy" />
            {:else}
              <span class="tv-card-icon" style={rt?.color ? `color:${rt.color}` : undefined}>{rt?.icon ?? '◆'}</span>
            {/if}
          </div>
          <span class="tv-card-title">{inst.title}</span>
          {#if summary(inst)}<span class="tv-card-summary">{summary(inst)}</span>{/if}
        </button>
      {/each}
    </div>
  {:else if locationProperty}
    <TypeViewMap {instances} {locationProperty} {onOpenNote} />
  {:else}
    <!-- A saved/persisted tab claims layout: 'map' but the type no longer has
         a geo property (e.g. edited after the view was saved) — fall back to
         a message rather than mounting a map with nothing to plot. -->
    <p class="tv-empty">This type has no location property.</p>
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
  .tv-cell-title-inner { display: flex; align-items: center; gap: 7px; }

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
