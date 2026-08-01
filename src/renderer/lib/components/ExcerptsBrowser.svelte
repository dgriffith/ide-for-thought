<script lang="ts">
  /**
   * Excerpts-as-a-browsable-type list (#1069). Projects `thought:Excerpt` (the
   * anchored quotations #indexExcerpt already writes — no data-model change) and
   * lets the user narrow by source, by a source tag, or by a citing note.
   * Clicking an excerpt opens its source at the anchor.
   *
   * Rendered inside the Objects panel (#1068) under the built-in "Excerpts" type.
   */
  import { api } from '../ipc/client';

  interface Props {
    onOpenExcerpt: (excerptId: string) => void;
  }
  let { onOpenExcerpt }: Props = $props();

  interface Excerpt { id: string; text: string; sourceTitle: string; }
  interface Opt { value: string; label: string; }

  let excerpts = $state<Excerpt[]>([]);
  let sourceOpts = $state<Opt[]>([]);
  let tagOpts = $state<Opt[]>([]);
  let noteOpts = $state<Opt[]>([]);

  // Active filters (empty = all).
  let sourceFilter = $state('');
  let tagFilter = $state('');
  let noteFilter = $state('');

  /** SPARQL string-literal escape for an interpolated filter value. */
  function lit(v: string): string {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  function excerptQuery(): string {
    const clauses = [
      `?e a thought:Excerpt ; minerva:excerptId ?id ; thought:citedText ?text .`,
      `OPTIONAL { ?e thought:fromSource ?src . OPTIONAL { ?src dc:title ?srcTitle } }`,
    ];
    if (sourceFilter) clauses.push(`?e thought:fromSource ?fs . ?fs minerva:sourceId ${lit(sourceFilter)} .`);
    if (tagFilter) clauses.push(`?e thought:fromSource ?ts . ?ts minerva:hasTag ?tt . ?tt minerva:tagName ${lit(tagFilter)} .`);
    if (noteFilter) clauses.push(`?fn thought:quotes ?e ; minerva:relativePath ${lit(noteFilter)} .`);
    return `SELECT ?id ?text ?srcTitle WHERE { ${clauses.join('\n')} } ORDER BY ?text`;
  }

  async function loadExcerpts(): Promise<void> {
    const { results } = await api.graph.query(excerptQuery());
    excerpts = (results as Array<{ id?: string; text?: string; srcTitle?: string }>)
      .filter((r): r is { id: string; text: string; srcTitle?: string } => !!r.id)
      .map((r) => ({ id: r.id, text: r.text ?? '', sourceTitle: r.srcTitle ?? '' }));
  }

  async function loadFilterOptions(): Promise<void> {
    const [srcs, tags, notes] = await Promise.all([
      api.graph.query(`SELECT DISTINCT ?src ?title WHERE { ?e a thought:Excerpt ; thought:fromSource ?s . ?s minerva:sourceId ?src . OPTIONAL { ?s dc:title ?title } } ORDER BY ?title`),
      api.graph.query(`SELECT DISTINCT ?tag WHERE { ?e a thought:Excerpt ; thought:fromSource ?s . ?s minerva:hasTag ?t . ?t minerva:tagName ?tag } ORDER BY ?tag`),
      api.graph.query(`SELECT DISTINCT ?path ?title WHERE { ?note thought:quotes ?e . ?e a thought:Excerpt . ?note minerva:relativePath ?path . OPTIONAL { ?note dc:title ?title } } ORDER BY ?title`),
    ]);
    sourceOpts = (srcs.results as Array<{ src: string; title?: string }>).map((r) => ({ value: r.src, label: r.title || r.src }));
    tagOpts = (tags.results as Array<{ tag: string }>).map((r) => ({ value: r.tag, label: r.tag }));
    noteOpts = (notes.results as Array<{ path: string; title?: string }>).map((r) => ({ value: r.path, label: r.title || r.path.replace(/\.md$/i, '').split('/').pop() || r.path }));
  }

  // Re-run the excerpt query whenever a filter changes; options load once.
  $effect(() => { sourceFilter; tagFilter; noteFilter; void loadExcerpts(); });
  $effect(() => { void loadFilterOptions(); });

  function snippet(text: string): string {
    const t = text.trim().replace(/\s+/g, ' ');
    return t.length > 90 ? t.slice(0, 88) + '…' : t;
  }
</script>

<div class="excerpts">
  <div class="filters">
    <select bind:value={sourceFilter} title="Filter by source">
      <option value="">All sources</option>
      {#each sourceOpts as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
    </select>
    <select bind:value={tagFilter} title="Filter by source tag">
      <option value="">All tags</option>
      {#each tagOpts as o (o.value)}<option value={o.value}>#{o.label}</option>{/each}
    </select>
    <select bind:value={noteFilter} title="Filter by citing note">
      <option value="">Any citing note</option>
      {#each noteOpts as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
    </select>
  </div>

  {#if excerpts.length === 0}
    <p class="empty">No excerpts{sourceFilter || tagFilter || noteFilter ? ' match these filters' : ' yet'}.</p>
  {:else}
    {#each excerpts as ex (ex.id)}
      <button class="excerpt-row" onclick={() => onOpenExcerpt(ex.id)} title={ex.text}>
        <span class="excerpt-text">“{snippet(ex.text)}”</span>
        {#if ex.sourceTitle}<span class="excerpt-source">{ex.sourceTitle}</span>{/if}
      </button>
    {/each}
  {/if}
</div>

<style>
  .excerpts { display: flex; flex-direction: column; gap: 3px; padding: 4px 8px 6px 30px; }
  .filters { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
  .filters select {
    width: 100%;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-inset);
    color: var(--text-muted);
    font-family: inherit;
    font-size: 11px;
    box-sizing: border-box;
  }
  .filters select:focus { outline: none; border-color: var(--accent); }
  .excerpt-row {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 5px 7px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .excerpt-row:hover { background: color-mix(in oklch, var(--text) 4%, transparent); color: var(--text); }
  .excerpt-text { font-size: 12px; line-height: 1.35; }
  .excerpt-source {
    font-size: 10px;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty { font-size: 11.5px; color: var(--text-faint); font-style: italic; padding: 4px 0; margin: 0; }
</style>
