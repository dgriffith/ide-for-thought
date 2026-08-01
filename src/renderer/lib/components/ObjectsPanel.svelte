<script lang="ts">
  /**
   * Objects-by-type browser (#1068). Top level = the registry's types (icon +
   * label + live instance count); expanding one projects `?x rdf:type :Type`
   * over the graph and lists its instances; clicking opens the note. Zero-
   * instance types stay visible so "create your first Book" is discoverable.
   *
   * A pure projection of the graph the #1062/#1063 indexing already builds — the
   * host calls `refresh()` on write/reindex (mirroring the Tags panel).
   */
  import { api } from '../ipc/client';
  import ExcerptsBrowser from './ExcerptsBrowser.svelte';
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

  async function loadCounts(): Promise<Record<string, number>> {
    const { results } = await api.graph.query(
      `SELECT ?id (COUNT(?x) AS ?n) WHERE { ?x a ?c . ?c minerva:typeId ?id } GROUP BY ?id`,
    );
    const out: Record<string, number> = {};
    for (const r of results as Array<{ id?: string; n?: string }>) {
      if (r.id) out[r.id] = Number(r.n ?? 0);
    }
    return out;
  }

  async function loadInstances(typeId: string): Promise<void> {
    const row = rows.find((r) => r.type.id === typeId);
    if (!row) return;
    const { results } = await api.graph.query(
      `SELECT ?path ?title WHERE {
         ?n a types:${row.type.classLocalName} ; minerva:relativePath ?path .
         OPTIONAL { ?n dc:title ?title }
       } ORDER BY ?title`,
    );
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
    const { results } = await api.graph.query(`SELECT (COUNT(?e) AS ?n) WHERE { ?e a thought:Excerpt }`);
    return Number((results as Array<{ n?: string }>)[0]?.n ?? 0);
  }

  export async function refresh(): Promise<void> {
    const [cat, counts, exCount] = await Promise.all([api.types.list(), loadCounts(), loadExcerptCount()]);
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

<div class="objects-panel">
  {#each rows as row (row.type.id)}
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
          <button
            class="instance-row"
            onclick={() => onFileSelect(inst.path)}
            ondblclick={() => onFileSelect(inst.path)}
            title={inst.path}
          >{inst.title}</button>
        {/each}
      {/if}
    {/if}
  {/each}

  <!-- Built-in Excerpts type (#1069): thought:Excerpt, browsable + filterable. -->
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

  {#if rows.length === 0 && excerptCount === 0}
    <p class="empty">No types or excerpts in this project yet.</p>
  {/if}
</div>

<style>
  .objects-panel { display: flex; flex-direction: column; padding: 4px; }
  .empty { font-size: 12px; color: var(--text-faint); padding: 12px 8px; }
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
    display: block;
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
</style>
