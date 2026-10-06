<script lang="ts">
  /**
   * Objects-by-type browser (#1068). Top level = the registry's types (icon +
   * label + live instance count); expanding one projects `?x rdf:type :Type`
   * over the graph and lists its instances; clicking opens the note. Zero-
   * instance types stay visible so "create your first Book" is discoverable —
   * unless the viewer opts into "Hide empty object types" (#2664).
   *
   * A pure projection of the graph the #1062/#1063 indexing already builds — the
   * host calls `refresh()` on write/reindex (mirroring the Tags panel).
   */
  import { api } from '../ipc/client';
  import { unwrapGraphQuery } from '../../../shared/graph-query';
  import TypeIcon from './TypeIcon.svelte';
  import { objectTypesStore } from '../stores/object-types.svelte';
  import ExcerptsBrowser from './ExcerptsBrowser.svelte';
  import { clampMenuToViewport } from '../utils/menuClamp';
  import { installDismissOnClickOutside } from '../dismiss-menu';
  import type { TypeInfo } from '../../../shared/objects/type-def';

  interface Props {
    onFileSelect: (relativePath: string) => void;
    /** Open an excerpt (source at its anchor) — for the built-in Excerpts type (#1069). */
    onOpenExcerpt?: (excerptId: string) => void;
    /** Open a type's instances in the main-pane list/table/gallery view (#1070). */
    onOpenType?: (typeId: string) => void;
  }
  let { onFileSelect, onOpenExcerpt, onOpenType }: Props = $props();

  interface TypeRow { type: TypeInfo; count: number; }
  interface Instance { title: string; path: string; }

  let rows = $state<TypeRow[]>([]);
  let expanded = $state<Set<string>>(new Set());
  let instances = $state<Record<string, Instance[]>>({});
  // Built-in Excerpts type (#1069) — thought:Excerpt, not a registry type.
  let excerptCount = $state(0);
  let excerptsOpen = $state(false);

  /** "Hide empty object types" (#2664): a per-machine display filter, default
   *  off. Not per-thoughtbase and not synced — a viewer convenience, so
   *  localStorage (wrapped: it can throw in private/blocked storage). */
  const HIDE_EMPTY_KEY = 'minerva.objectsPanel.hideEmpty';
  let hideEmpty = $state<boolean>(loadHideEmpty());
  function loadHideEmpty(): boolean {
    try { return localStorage.getItem(HIDE_EMPTY_KEY) === 'true'; } catch { return false; }
  }
  function setHideEmpty(next: boolean): void {
    hideEmpty = next;
    try { localStorage.setItem(HIDE_EMPTY_KEY, String(next)); } catch { /* ok */ }
  }

  // Hiding uses the same subclass-aware count the row shows (#1587), so a
  // parent with instances only through a subtype stays. Derived from `rows`,
  // which refresh() reloads on every write — so the list updates live.
  const visibleRows = $derived(hideEmpty ? rows.filter((r) => r.count > 0) : rows);
  const showExcerpts = $derived(!hideEmpty || excerptCount > 0);
  const allHidden = $derived(
    hideEmpty && visibleRows.length === 0 && !showExcerpts && (rows.length > 0 || excerptCount > 0),
  );

  let contextMenu = $state<{ x: number; y: number } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();
  $effect(() => {
    if (!contextMenu || !contextMenuEl) return;
    const next = clampMenuToViewport(contextMenu.x, contextMenu.y, contextMenuEl);
    if (next.x !== contextMenu.x || next.y !== contextMenu.y) contextMenu = { ...next };
  });
  function handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY };
    installDismissOnClickOutside(() => { contextMenu = null; });
  }

  async function loadCounts(): Promise<Record<string, number>> {
    // Subclass-aware (#1587): count each instance under its type AND every
    // ancestor, so a parent's count includes its subclasses' instances.
    const { results } = unwrapGraphQuery(await api.graph.query(
      `SELECT ?id (COUNT(DISTINCT ?x) AS ?n) WHERE { ?x a ?sub . ?sub rdfs:subClassOf* ?c . ?c minerva:typeId ?id } GROUP BY ?id`,
    ));
    const out: Record<string, number> = {};
    for (const r of results as Array<{ id?: string; n?: string }>) {
      if (r.id) out[r.id] = Number(r.n ?? 0);
    }
    return out;
  }

  async function loadInstances(typeId: string): Promise<void> {
    const row = rows.find((r) => r.type.id === typeId);
    if (!row) return;
    const { results } = unwrapGraphQuery(await api.graph.query(
      `SELECT ?path ?title WHERE {
         ?n a/rdfs:subClassOf* types:${row.type.classLocalName} ; minerva:relativePath ?path .
         OPTIONAL { ?n dc:title ?title }
       } ORDER BY ?title`,
    ));
    instances[typeId] = (results as Array<{ path?: string; title?: string }>)
      .filter((r): r is { path: string; title?: string } => !!r.path)
      .map((r) => ({ path: r.path, title: r.title || basename(r.path) }));
    instances = { ...instances };
  }

  function basename(path: string): string {
    return path.replace(/\.md$/i, '').split('/').pop() || path;
  }

  /** Reload counts, and re-project any expanded type. Called on mount + by the
   *  host after a write/reindex. */
  async function loadExcerptCount(): Promise<number> {
    const { results } = unwrapGraphQuery(await api.graph.query(`SELECT (COUNT(?e) AS ?n) WHERE { ?e a thought:Excerpt }`));
    return Number((results as Array<{ n?: string }>)[0]?.n ?? 0);
  }

  export async function refresh(): Promise<void> {
    const [cat, counts, exCount] = await Promise.all([
      api.types.list(),
      loadCounts(),
      loadExcerptCount(),
    ]);
    rows = cat.types.map((type) => ({ type, count: counts[type.id] ?? 0 }));
    excerptCount = exCount;
    await Promise.all([...expanded].map((id) => loadInstances(id)));
  }

  async function toggle(typeId: string): Promise<void> {
    if (expanded.has(typeId)) expanded.delete(typeId);
    else { expanded.add(typeId); await loadInstances(typeId); }
    expanded = new Set(expanded);
  }

  // Populate whenever the panel is switched into (mount), not only on refresh().
  $effect(() => { void refresh(); });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="objects-panel" oncontextmenu={handleContextMenu}>
  <div class="controls-row">
    <label class="hide-empty-toggle" title="Hide empty object types">
      <input type="checkbox" checked={hideEmpty} onchange={(e) => setHideEmpty(e.currentTarget.checked)} />
      <span>hide empty</span>
    </label>
  </div>

  {#each visibleRows as row (row.type.id)}
    {@const open = expanded.has(row.type.id)}
    <div class="type-row-wrap">
      <button class="type-row" onclick={() => toggle(row.type.id)} aria-expanded={open}>
        <span class="chevron" class:open>▸</span>
        <span class="type-icon" style={row.type.color ? `color:${row.type.color}` : undefined}>{row.type.icon ?? '◆'}</span>
        <span class="type-label">{row.type.label}</span>
        <span class="type-count">{row.count}</span>
      </button>
      {#if onOpenType}
        <!-- Open all instances of this type in the main-pane multi-view (#1070). -->
        <button class="open-view" title={`Open ${row.type.label} view`} aria-label={`Open ${row.type.label} view`} onclick={() => onOpenType(row.type.id)}>⤢</button>
      {/if}
    </div>
    {#if open}
      {#if (instances[row.type.id] ?? []).length === 0}
        <p class="no-instances">No {row.type.label.toLowerCase()} yet</p>
      {:else}
        {#each instances[row.type.id] ?? [] as inst (inst.path)}
          <!-- The group is subclass-aware (#1587) — a Book group lists Novels
               too — so a row carries its OWN type's icon, not the group's. -->
          {@const instType = objectTypesStore.typeForNote(inst.path) ?? row.type}
          <button
            class="instance-row"
            onclick={() => onFileSelect(inst.path)}
            ondblclick={() => onFileSelect(inst.path)}
            title={inst.path}
          >
            <TypeIcon type={instType} size={12} />
            <span class="instance-name">{inst.title}</span>
          </button>
        {/each}
      {/if}
    {/if}
  {/each}

  <!-- Built-in Excerpts type (#1069): thought:Excerpt, browsable + filterable.
       Hidden by the same rule as a type row when there are none (#2664). -->
  {#if showExcerpts}
    <button class="type-row" onclick={() => (excerptsOpen = !excerptsOpen)} aria-expanded={excerptsOpen}>
      <span class="chevron" class:open={excerptsOpen}>▸</span>
      <span class="type-icon">✂️</span>
      <span class="type-label">Excerpts</span>
      <span class="type-count">{excerptCount}</span>
    </button>
    {#if excerptsOpen}
      {#if onOpenExcerpt}
        <ExcerptsBrowser {onOpenExcerpt} />
      {/if}
    {/if}
  {/if}

  {#if rows.length === 0 && excerptCount === 0}
    <p class="empty">No types or excerpts in this project yet.</p>
  {:else if allHidden}
    <!-- Everything filtered out (a fresh thoughtbase): say so, not a blank panel. -->
    <p class="empty">No object types in use. <button class="show-all" onclick={() => setHideEmpty(false)}>Show all</button></p>
  {/if}

</div>

{#if contextMenu}
  <div
    class="context-menu"
    role="menu"
    bind:this={contextMenuEl}
    style:left="{contextMenu.x}px"
    style:top="{contextMenu.y}px"
  >
    <button class="check-item" role="menuitemcheckbox" aria-checked={hideEmpty} onclick={() => { setHideEmpty(!hideEmpty); contextMenu = null; }}>
      <span class="check">{hideEmpty ? '✓' : ''}</span>Hide Empty Object Types
    </button>
  </div>
{/if}

<style>
  /* The panel is the scroller: bounded by the sidebar (flex: 1 + min-height: 0)
     and scrolling inside it. It had no height constraint at all, so a long type
     list ran off the bottom of the window with nothing to scroll. */
  .objects-panel { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; padding: 4px; }
  .empty { font-size: 12px; color: var(--text-faint); padding: 12px 8px; }
  .controls-row {
    display: flex;
    justify-content: flex-end;
    padding: 2px 8px 4px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .hide-empty-toggle { display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }
  .hide-empty-toggle input { cursor: pointer; }
  .show-all {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .show-all:hover { text-decoration: underline; }
  /* Base shape shared via .context-menu in global.css (#1910). The one item is
     a checkable row with a check gutter, so it is styled by its own class. */
  .context-menu { min-width: 200px; }
  .check-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 12px 6px 6px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .check-item:hover { background: var(--bg-button); }
  .check { width: 16px; flex-shrink: 0; text-align: center; }
  .type-row-wrap { position: relative; display: flex; align-items: center; }
  .type-row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }
  .type-row:hover { background: color-mix(in oklch, var(--text) 4%, transparent); }
  /* Hover-revealed "open in main view" affordance — stays out of the way until
     the row is hovered/focused (house UX: quiet contextual actions, #1070). */
  .open-view {
    position: absolute;
    right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.1s ease;
  }
  .type-row-wrap:hover .open-view,
  .open-view:focus-visible { opacity: 1; }
  .open-view:hover { color: var(--text); }
  .chevron {
    font-size: 9px;
    color: var(--text-faint);
    transition: transform 0.12s ease;
    width: 9px;
    flex-shrink: 0;
  }
  .chevron.open { transform: rotate(90deg); }
  .type-icon { width: 16px; font-size: 13px; line-height: 1; text-align: center; flex-shrink: 0; }
  .type-label { flex: 1; font-weight: 500; }
  .type-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .instance-row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 4px 8px 4px 30px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  /* Ellipsis moves to the label now that the row is a flex container. */
  .instance-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .instance-row:hover { background: color-mix(in oklch, var(--text) 4%, transparent); color: var(--text); }
  .no-instances {
    font-size: 11.5px;
    color: var(--text-faint);
    font-style: italic;
    padding: 4px 8px 4px 30px;
    margin: 0;
  }
  /* Now that the column has a definite height, every row keeps its natural
     height: the Excerpts row is a `.type-row` (flex: 1, for its row layout),
     which would otherwise stretch to fill the panel, and a child with
     overflow: hidden would shrink to nothing. Last, so it wins on order. */
  .objects-panel > :global(*) { flex: none; }
</style>
