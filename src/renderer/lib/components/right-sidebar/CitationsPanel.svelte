<script lang="ts">
  /**
   * Per-note Citations panel: lists every [[cite::source-id]] and
   * [[quote::excerpt-id]] in the active note. Citations open the source
   * tab; quotes open the source scrolled to the excerpt.
   *
   * Sources are fetched once per panel mount to label cite entries with
   * their title. Excerpt labels aren't pre-fetched — the existing
   * excerpt → source resolver handles that at click time, same as the
   * editor's inline click.
   */
  import { onMount } from 'svelte';
  import { api } from '../../ipc/client';
  import type { SourceMetadata } from '../../../../shared/types';
  import Ribbon from './Ribbon.svelte';

  interface Props {
    content: string;
    onOpenSource: (sourceId: string) => void;
    onOpenExcerpt: (excerptId: string) => void;
  }

  let { content, onOpenSource, onOpenExcerpt }: Props = $props();

  let sourcesById = $state<Record<string, SourceMetadata>>({});
  let search = $state('');
  let sortId = $state<'document' | 'alpha' | 'kind'>('document');

  onMount(async () => {
    try {
      const all = await api.sources.listAll();
      sourcesById = Object.fromEntries(all.map((s) => [s.sourceId, s]));
    } catch { /* no project or sources dir missing — leave empty */ }
  });

  // [[cite::id]] and [[quote::id]] with optional |label suffix. Case on
  // the typed prefix is normalised to lowercase so CITE/Cite still
  // catches — consistent with the editor's decoration rules.
  const citeRe = /\[\[(cite|quote)::([^\]|]+)(?:\|[^\]]*)?\]\]/g;

  function labelFor(kind: 'cite' | 'quote', id: string): string {
    if (kind === 'cite') {
      const src = sourcesById[id];
      return src?.title || id;
    }
    return id;
  }

  const entries = $derived(() => {
    const out: { kind: 'cite' | 'quote'; id: string }[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    citeRe.lastIndex = 0;
    while ((m = citeRe.exec(content)) !== null) {
      const kind = m[1].toLowerCase() as 'cite' | 'quote';
      const id = m[2].trim();
      const key = `${kind}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, id });
    }
    const q = search.trim().toLowerCase();
    const filtered = q
      ? out.filter((e) => labelFor(e.kind, e.id).toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
      : out;
    if (sortId === 'alpha') {
      return [...filtered].sort((a, b) => labelFor(a.kind, a.id).localeCompare(labelFor(b.kind, b.id)));
    }
    if (sortId === 'kind') {
      // cite first, quote second, stable within kind — gives a predictable
      // grouping without inventing a separate group-header UI just for this.
      return [...filtered].sort((a, b) => {
        if (a.kind === b.kind) return 0;
        return a.kind === 'cite' ? -1 : 1;
      });
    }
    return filtered;
  });
</script>

<div class="cite-panel">
  <Ribbon
    {search}
    onSearch={(q) => { search = q; }}
    searchPlaceholder="Find citation…"
    sortOptions={[
      { id: 'document', label: 'Document order' },
      { id: 'alpha', label: 'Alphabetical' },
      { id: 'kind', label: 'By kind' },
    ]}
    {sortId}
    onSort={(id) => { sortId = id as 'document' | 'alpha' | 'kind'; }}
  />
  <div class="scroll">
    {#if entries().length === 0}
      <div class="empty">No citations in this note</div>
    {:else}
      <div class="count">{entries().length} citation{entries().length !== 1 ? 's' : ''}</div>
      {#each entries() as e}
        <button
          class="row"
          onclick={() => e.kind === 'cite' ? onOpenSource(e.id) : onOpenExcerpt(e.id)}
          title={`${e.kind}::${e.id}`}
        >
          <span class="badge" class:quote={e.kind === 'quote'}>{e.kind === 'cite' ? 'cite' : 'quote'}</span>
          <span class="label">{labelFor(e.kind, e.id)}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .cite-panel {
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
    gap: 6px;
    width: 100%;
    padding: 3px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .row:hover { background: var(--bg-button); }
  .badge {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--bg-button);
    color: var(--text-muted);
  }
  .badge.quote { background: var(--accent); color: var(--bg); }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center; }
</style>
