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
  import Icon from '../Icon.svelte';

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
        {@const missing = !g.title}
        <div class="source-row" class:missing>
          <div class="source-line">
            <button
              class="disclose"
              class:has-excerpts={hasExcerpts}
              onclick={() => { if (hasExcerpts) expanded = { ...expanded, [g.sourceId]: !isExpanded }; }}
              disabled={!hasExcerpts}
              aria-label={hasExcerpts ? (isExpanded ? 'Collapse excerpts' : 'Expand excerpts') : ''}
            >
              {#if hasExcerpts}
                <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={11} color="var(--text-faint)" />
              {/if}
            </button>
            <Icon name={missing ? 'warn' : 'source'} size={14} color={missing ? 'var(--rust)' : 'var(--text-muted)'} />
            <button
              class="source-main"
              onclick={() => onOpenSource(g.sourceId)}
              title={g.sourceId}
            >
              <div class="source-title">{g.title ?? g.sourceId}</div>
              {#if missing}
                <div class="source-byline">{totalCount(g)} references · uncited</div>
              {:else if bylineFor(g)}
                <div class="source-byline">{bylineFor(g)}</div>
              {/if}
            </button>
            {#if !missing}
              <span class="cite-stat" title={`${g.citeCount} cite${g.citeCount === 1 ? '' : 's'}, ${g.quoteCount} quote${g.quoteCount === 1 ? '' : 's'}`}>
                {#if g.citeCount > 0}<span class="stat-cite">{g.citeCount}</span>{/if}
                {#if g.quoteCount > 0}<span class="stat-quote">{g.quoteCount}″</span>{/if}
              </span>
            {/if}
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
                      <span class="excerpt-text">“{truncate(ex.citedText, 100)}”</span>
                    {:else}
                      <span class="excerpt-text excerpt-id">{ex.excerptId}</span>
                    {/if}
                    <span class="excerpt-meta">
                      {#if locator}
                        <span class="excerpt-locator">{locator}</span>
                      {/if}
                      {#if ex.quoteCount > 1}
                        <span class="excerpt-count">×{ex.quoteCount}</span>
                      {/if}
                    </span>
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
    padding: 6px 12px 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.04em;
  }
  /* Per source (§13.6) — source icon + (italic display-serif title +
     sans byline stacked) + cite/quote split chip on the right. */
  .source-row {
    border-top: 1px solid var(--border);
  }
  .source-row:first-of-type { border-top: none; }

  .source-line {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
  }
  .disclose {
    flex-shrink: 0;
    width: 12px;
    height: 18px;
    border: none;
    background: none;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .disclose:disabled { cursor: default; visibility: hidden; }

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
    gap: 2px;
  }
  .source-main:hover .source-title { color: var(--accent); }
  /* Editorial title — italic display-serif, the panel's signature. */
  .source-title {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 13.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .source-row.missing .source-title {
    color: var(--rust);
    font-style: italic;
  }
  .source-byline {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .source-byline :global(.year),
  .source-row.missing .source-byline {
    font-family: var(--font-mono);
  }

  /* Cite/quote split: cite count on the left, quote count with a "
     marker on the right. Both in mono-faint. */
  .cite-stat {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .stat-cite { color: var(--text-muted); }
  .stat-quote { color: var(--accent); }

  /* Attached excerpts — block-quote chunks indented under the source
     with a 2px accent rail, italic display-serif text, mono locator. */
  .excerpts {
    list-style: none;
    margin: 0 12px 10px 36px;
    padding: 0;
    border-left: 2px solid color-mix(in oklch, var(--accent) 40%, transparent);
  }
  .excerpts li { margin: 0; }
  .excerpt {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    text-align: left;
    padding: 4px 10px;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 12.5px;
    line-height: 1.45;
  }
  .excerpt:hover {
    background: color-mix(in oklch, var(--accent) 6%, transparent);
    color: var(--text);
  }
  .excerpt-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .excerpt-id {
    font-family: var(--font-mono);
    font-style: normal;
    color: var(--text-faint);
  }
  .excerpt-meta {
    flex-shrink: 0;
    display: inline-flex;
    gap: 6px;
    font-family: var(--font-mono);
    font-style: normal;
    font-size: 10px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .excerpt-locator { color: var(--text-muted); }
  .empty {
    padding: 12px;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
