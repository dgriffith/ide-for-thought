<script lang="ts">
  /**
   * Per-source citation panel (#111).
   *
   * Aggregates every `[[cite::id]]` and `[[quote::ex]]` in the active
   * note into one row per cited source — title, year, byline, total
   * occurrence count, and the list of excerpts the note quotes from
   * that source. Driven by a SPARQL query in main (`thought:cites` +
   * `thought:quotes` → fromSource), with occurrence counts re-derived
   * from the live editor buffer so the count reflects what the user
   * is typing, not the last save.
   *
   * Click a source row → open its tab. Click an excerpt → open the
   * source scrolled to the excerpt.
   */
  import { api } from '../../ipc/client';
  import type { CitationGroup } from '../../../../shared/types';
  import Ribbon from './Ribbon.svelte';

  interface Props {
    activeFilePath: string | null;
    content: string;
    revision: number;
    onOpenSource: (sourceId: string) => void;
    onOpenExcerpt: (excerptId: string) => void;
  }

  let { activeFilePath, content, revision, onOpenSource, onOpenExcerpt }: Props = $props();

  let groups = $state<CitationGroup[]>([]);
  let search = $state('');
  let sortId = $state<'count' | 'alpha'>('count');
  let expanded = $state<Record<string, boolean>>({});

  // Debounce content-driven refreshes — re-running the IPC on every
  // keystroke is wasteful, especially because the graph has to walk
  // its `thought:cites` / `thought:quotes` indexes for the active
  // note and citation edits are rare relative to typing.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    // Track activeFilePath, content, and revision reactively.
    const path = activeFilePath;
    const c = content;
    revision;
    if (!path) {
      groups = [];
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void api.links.citationsForNote(path, c).then((result) => {
        groups = result;
      }).catch(() => {
        groups = [];
      });
      debounceTimer = null;
    }, 200);
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };
  });

  function bylineFor(g: CitationGroup): string {
    const who = g.creators.length === 0 ? ''
      : g.creators.length === 1 ? g.creators[0]
      : g.creators.length === 2 ? `${g.creators[0]} and ${g.creators[1]}`
      : `${g.creators[0]} et al.`;
    if (who && g.year) return `${who} · ${g.year}`;
    return who || (g.year ?? '');
  }

  function totalCount(g: CitationGroup): number {
    return g.citeCount + g.quoteCount;
  }

  function matchesSearch(g: CitationGroup, q: string): boolean {
    if (!q) return true;
    if ((g.title ?? '').toLowerCase().includes(q)) return true;
    if (g.sourceId.toLowerCase().includes(q)) return true;
    if (g.creators.some((c) => c.toLowerCase().includes(q))) return true;
    // Search inside excerpt cited text, so a user looking for "growth"
    // can find the source they quoted that phrase from.
    if (g.excerpts.some((e) => (e.citedText ?? '').toLowerCase().includes(q))) return true;
    return false;
  }

  const visible = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const filtered = groups.filter((g) => matchesSearch(g, q));
    if (sortId === 'alpha') {
      return [...filtered].sort((a, b) => {
        const ta = (a.title ?? a.sourceId).toLowerCase();
        const tb = (b.title ?? b.sourceId).toLowerCase();
        return ta.localeCompare(tb);
      });
    }
    return filtered;
  });

  function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1).trimEnd() + '…';
  }

  function locatorFor(ex: CitationGroup['excerpts'][number]): string | null {
    if (ex.page) return `p. ${ex.page}`;
    if (ex.pageRange) return `pp. ${ex.pageRange}`;
    if (ex.locationText) return ex.locationText;
    return null;
  }
</script>

<div class="cite-panel">
  <Ribbon
    {search}
    onSearch={(q: string) => { search = q; }}
    searchPlaceholder="Find source…"
    sortOptions={[
      { id: 'count', label: 'Most cited' },
      { id: 'alpha', label: 'Alphabetical' },
    ]}
    {sortId}
    onSort={(id: string) => { sortId = id as 'count' | 'alpha'; }}
  />
  <div class="scroll">
    {#if visible.length === 0}
      <div class="empty">No citations in this note</div>
    {:else}
      <div class="count">
        {visible.length} source{visible.length === 1 ? '' : 's'} cited
      </div>
      {#each visible as g (g.sourceId)}
        {@const isExpanded = expanded[g.sourceId] ?? false}
        {@const hasExcerpts = g.excerpts.length > 0}
        <div class="source-row">
          <div class="source-line">
            <button
              class="disclose"
              class:has-excerpts={hasExcerpts}
              onclick={() => { if (hasExcerpts) expanded = { ...expanded, [g.sourceId]: !isExpanded }; }}
              disabled={!hasExcerpts}
              aria-label={hasExcerpts ? (isExpanded ? 'Collapse excerpts' : 'Expand excerpts') : ''}
            >{hasExcerpts ? (isExpanded ? '▾' : '▸') : ''}</button>
            <button
              class="source-main"
              onclick={() => onOpenSource(g.sourceId)}
              title={g.sourceId}
            >
              <div class="source-title">{g.title ?? g.sourceId}</div>
              {#if bylineFor(g)}
                <div class="source-byline">{bylineFor(g)}</div>
              {/if}
            </button>
            <span class="count-badge" title={`${g.citeCount} cite${g.citeCount === 1 ? '' : 's'}, ${g.quoteCount} quote${g.quoteCount === 1 ? '' : 's'}`}>
              {totalCount(g)}×
            </span>
          </div>
          {#if isExpanded && hasExcerpts}
            <ul class="excerpts">
              {#each g.excerpts as ex (ex.excerptId)}
                {@const locator = locatorFor(ex)}
                <li>
                  <button
                    class="excerpt"
                    onclick={() => onOpenExcerpt(ex.excerptId)}
                    title={ex.excerptId}
                  >
                    {#if ex.citedText}
                      <span class="excerpt-text">“{truncate(ex.citedText, 80)}”</span>
                    {:else}
                      <span class="excerpt-text excerpt-id">{ex.excerptId}</span>
                    {/if}
                    {#if locator}
                      <span class="excerpt-locator">{locator}</span>
                    {/if}
                    {#if ex.quoteCount > 1}
                      <span class="excerpt-count">×{ex.quoteCount}</span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
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
  .source-row {
    border-bottom: 1px solid var(--border);
  }
  .source-row:last-child { border-bottom: none; }
  .source-line {
    display: flex;
    align-items: stretch;
    gap: 4px;
    padding: 4px 8px;
  }
  .disclose {
    flex-shrink: 0;
    width: 16px;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
    align-self: flex-start;
    margin-top: 3px;
  }
  .disclose:disabled { cursor: default; visibility: hidden; }
  .disclose.has-excerpts:hover { color: var(--text); }
  .source-main {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .source-main:hover .source-title { color: var(--accent); }
  .source-title {
    font-size: 12px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .source-byline {
    font-size: 10px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count-badge {
    flex-shrink: 0;
    align-self: flex-start;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--bg-button);
    color: var(--text-muted);
    margin-top: 2px;
  }
  .excerpts {
    list-style: none;
    margin: 0;
    padding: 0 8px 6px 28px;
  }
  .excerpts li { margin: 0; }
  .excerpt {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    border: none;
    background: none;
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
    text-align: left;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .excerpt:hover { background: var(--bg-button); }
  .excerpt-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .excerpt-id {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
    color: var(--text-muted);
  }
  .excerpt-locator {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-muted);
  }
  .excerpt-count {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-muted);
  }
  .empty {
    padding: 12px;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
