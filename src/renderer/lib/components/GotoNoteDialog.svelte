<script lang="ts">
  import type { NoteFile, SourceMetadata, SavedQuery } from '../../../shared/types';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons/registry';
  import { formatRelativeTime } from '../utils/format-relative-time';

  type Scope = 'all' | 'notes' | 'sources' | 'queries';

  interface NoteItem { kind: 'note'; name: string; relativePath: string; mtimeMs?: number; score: number }
  interface SourceItem { kind: 'source'; name: string; sourceId: string; byline: string | null; score: number }
  interface QueryItem { kind: 'query'; name: string; query: SavedQuery; score: number }
  type PaletteItem = NoteItem | SourceItem | QueryItem;

  interface Props {
    files: NoteFile[];
    onSelect: (relativePath: string) => void;
    onCancel: () => void;
    /** Placeholder text inside the search input. Default "Go to..." */
    placeholder?: string;
    /** Drop a single relativePath from the candidate list — used by Merge
     *  Note (#464) so the user can't pick the source as the merge target. */
    excludePath?: string;
    /** When supplied, sources participate in the palette and the
     *  Sources scope chip appears. Required to make the chip useful;
     *  callers like Merge-Note (notes-only) leave this out. */
    sources?: SourceMetadata[];
    /** When supplied, saved queries participate too. */
    savedQueries?: SavedQuery[];
    /** Called when the user picks a source row. Required when `sources`
     *  is provided. */
    onSelectSource?: (sourceId: string) => void;
    /** Called when the user picks a query row. Required when
     *  `savedQueries` is provided. */
    onSelectQuery?: (query: SavedQuery) => void;
  }

  let {
    files, onSelect, onCancel, placeholder = 'Go to...', excludePath,
    sources, savedQueries, onSelectSource, onSelectQuery,
  }: Props = $props();

  let query = $state('');
  let scope = $state<Scope>('all');
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement>();

  /** Whether the palette is in multi-scope mode. When false, the
   *  scope chip row is hidden and behavior matches the notes-only
   *  picker that Merge-Note has always used. */
  const multiScope = $derived(!!(sources && sources.length > 0) || !!(savedQueries && savedQueries.length > 0));

  // Flatten note tree.
  function flattenNotes(items: NoteFile[], acc: { name: string; relativePath: string; mtimeMs?: number }[] = []): { name: string; relativePath: string; mtimeMs?: number }[] {
    for (const f of items) {
      if (f.isDirectory) {
        if (f.children) flattenNotes(f.children, acc);
      } else {
        acc.push({
          name: f.name.replace(/\.md$/, ''),
          relativePath: f.relativePath,
          mtimeMs: f.mtimeMs,
        });
      }
    }
    return acc;
  }

  const allNotes = flattenNotes(files).filter((n) => n.relativePath !== excludePath);
  const allSources = $derived(sources ?? []);
  const allQueries = $derived(savedQueries ?? []);

  // Per-scope unfiltered counts — drive the chip labels.
  const totalCounts = $derived({
    notes: allNotes.length,
    sources: allSources.length,
    queries: allQueries.length,
  });

  function scoreMatch(name: string, secondary: string | null, q: string): number {
    const lowerName = name.toLowerCase();
    const lowerSecondary = secondary?.toLowerCase() ?? '';
    const lowerQ = q.toLowerCase();
    if (lowerName.includes(lowerQ)) return 100;
    if (lowerSecondary && lowerSecondary.includes(lowerQ)) return 80;
    if (firstLetterMatch(name, q)) return 90;
    if (camelCaseMatch(name, q)) return 85;
    if (fuzzyMatch(lowerName, lowerQ)) return 50;
    if (lowerSecondary && fuzzyMatch(lowerSecondary, lowerQ)) return 30;
    return 0;
  }

  function firstLetterMatch(name: string, q: string): boolean {
    const words = name.split(/[\s\-_]+/);
    const letters = q.toLowerCase();
    if (letters.length > words.length) return false;
    for (let i = 0; i < letters.length; i++) {
      if (i >= words.length) return false;
      if (words[i][0]?.toLowerCase() !== letters[i]) return false;
    }
    return true;
  }

  function camelCaseMatch(name: string, q: string): boolean {
    const capitals: string[] = [];
    for (let i = 0; i < name.length; i++) {
      if (i === 0 || name[i] === name[i].toUpperCase() && name[i] !== name[i].toLowerCase()) {
        capitals.push(name[i].toLowerCase());
      }
    }
    const qLower = q.toLowerCase();
    if (qLower.length > capitals.length) return false;
    for (let i = 0; i < qLower.length; i++) {
      if (capitals[i] !== qLower[i]) return false;
    }
    return true;
  }

  function fuzzyMatch(text: string, query: string): boolean {
    let ti = 0;
    for (let qi = 0; qi < query.length; qi++) {
      const idx = text.indexOf(query[qi], ti);
      if (idx === -1) return false;
      ti = idx + 1;
    }
    return true;
  }

  /**
   * Combined, scored, scope-filtered, query-filtered result list. The
   * three palette item kinds carry enough metadata for rendering and
   * for the kind-specific onSelect dispatch.
   */
  const results = $derived.by<PaletteItem[]>(() => {
    const q = query.trim();
    const isRegex = q.length > 0 && /[.*+?^${}()|[\]\\]/.test(q);
    let regex: RegExp | null = null;
    if (isRegex) {
      try { regex = new RegExp(q, 'i'); } catch { /* fall back to fuzzy */ }
    }

    const mkNote = (n: { name: string; relativePath: string; mtimeMs?: number }, score: number): NoteItem =>
      ({ kind: 'note', name: n.name, relativePath: n.relativePath, mtimeMs: n.mtimeMs, score });
    const mkSource = (s: SourceMetadata, score: number): SourceItem =>
      ({ kind: 'source', name: s.title ?? s.sourceId, sourceId: s.sourceId, byline: formatByline(s), score });
    const mkQuery = (qy: SavedQuery, score: number): QueryItem =>
      ({ kind: 'query', name: qy.name, query: qy, score });

    const noteItems: NoteItem[] = (scope === 'all' || scope === 'notes')
      ? allNotes.flatMap((n) => {
        if (!q) return [mkNote(n, 0)];
        if (regex) return regex.test(n.name) || regex.test(n.relativePath) ? [mkNote(n, 1)] : [];
        const s = scoreMatch(n.name, n.relativePath, q);
        return s > 0 ? [mkNote(n, s)] : [];
      })
      : [];

    const sourceItems: SourceItem[] = (scope === 'all' || scope === 'sources')
      ? allSources.flatMap((s) => {
        const name = s.title ?? s.sourceId;
        if (!q) return [mkSource(s, 0)];
        if (regex) return regex.test(name) || regex.test(s.sourceId) ? [mkSource(s, 1)] : [];
        const score = scoreMatch(name, formatByline(s) ?? s.sourceId, q);
        return score > 0 ? [mkSource(s, score)] : [];
      })
      : [];

    const queryItems: QueryItem[] = (scope === 'all' || scope === 'queries')
      ? allQueries.flatMap((qy) => {
        if (!q) return [mkQuery(qy, 0)];
        if (regex) return regex.test(qy.name) || regex.test(qy.description) ? [mkQuery(qy, 1)] : [];
        const score = scoreMatch(qy.name, qy.description, q);
        return score > 0 ? [mkQuery(qy, score)] : [];
      })
      : [];

    const combined: PaletteItem[] = [...noteItems, ...sourceItems, ...queryItems];
    combined.sort((a, b) => b.score - a.score);
    return combined.slice(0, 60);
  });

  function formatByline(s: SourceMetadata): string | null {
    const who = s.creators.length === 0 ? ''
      : s.creators.length === 1 ? s.creators[0]
      : `${s.creators[0]} et al.`;
    if (who && s.year) return `${who} (${s.year})`;
    return who || s.year || null;
  }

  function selectItem(item: PaletteItem): void {
    if (item.kind === 'note') onSelect(item.relativePath);
    else if (item.kind === 'source') onSelectSource?.(item.sourceId);
    else if (item.kind === 'query') onSelectQuery?.(item.query);
  }

  // Reset selection when filtered results change.
  $effect(() => {
    results;
    selectedIndex = 0;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[selectedIndex];
      if (picked) selectItem(picked);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }

  $effect(() => { inputEl?.focus(); });
  $effect(() => {
    const el = document.querySelector('.goto-results .selected');
    el?.scrollIntoView({ block: 'nearest' });
  });

  function kindIconName(kind: PaletteItem['kind']): IconName {
    if (kind === 'note') return 'notes';
    if (kind === 'source') return 'sites';
    return 'query';
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Go to">
    <div class="input-row">
      <Icon name="search" size={14} color="var(--text-muted)" />
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        class="input"
        {placeholder}
      />
      <span class="input-kbd">⌘ P</span>
    </div>

    {#if multiScope}
      <div class="scope-row" role="tablist">
        <button class="scope-chip" class:active={scope === 'all'} onclick={() => { scope = 'all'; }} role="tab" aria-selected={scope === 'all'}>
          <span>All</span>
          <span class="scope-count">{totalCounts.notes + totalCounts.sources + totalCounts.queries}</span>
        </button>
        <button class="scope-chip" class:active={scope === 'notes'} onclick={() => { scope = 'notes'; }} role="tab" aria-selected={scope === 'notes'}>
          <span>Notes</span>
          <span class="scope-count">{totalCounts.notes}</span>
        </button>
        {#if totalCounts.sources > 0}
          <button class="scope-chip" class:active={scope === 'sources'} onclick={() => { scope = 'sources'; }} role="tab" aria-selected={scope === 'sources'}>
            <span>Sources</span>
            <span class="scope-count">{totalCounts.sources}</span>
          </button>
        {/if}
        {#if totalCounts.queries > 0}
          <button class="scope-chip" class:active={scope === 'queries'} onclick={() => { scope = 'queries'; }} role="tab" aria-selected={scope === 'queries'}>
            <span>Queries</span>
            <span class="scope-count">{totalCounts.queries}</span>
          </button>
        {/if}
      </div>
    {/if}

    {#if results.length > 0}
      <ul class="goto-results">
        {#each results as result, i (`${result.kind}::${result.kind === 'note' ? result.relativePath : result.kind === 'source' ? result.sourceId : result.query.id}`)}
          {@const folder = result.kind === 'note' && result.relativePath.includes('/')
            ? result.relativePath.slice(0, result.relativePath.lastIndexOf('/'))
            : ''}
          <li>
            <button
              class="result-item"
              class:selected={i === selectedIndex}
              onclick={() => selectItem(result)}
              onmouseenter={() => { selectedIndex = i; }}
            >
              <Icon name={kindIconName(result.kind)} size={13} color={i === selectedIndex ? 'var(--accent)' : 'var(--text-faint)'} />
              <span class="result-body">
                <span class="result-name">{result.name}</span>
                {#if result.kind === 'note'}
                  {#if folder}
                    <span class="result-path">{folder}</span>
                  {/if}
                  {#if result.mtimeMs}
                    <span class="result-meta">{formatRelativeTime(result.mtimeMs)}</span>
                  {/if}
                {:else if result.kind === 'source'}
                  {#if result.byline}<span class="result-path">{result.byline}</span>{/if}
                {:else if result.kind === 'query'}
                  {#if result.query.description}<span class="result-path">{result.query.description}</span>{/if}
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if query.trim()}
      <div class="no-results">No matches</div>
    {/if}

    <footer class="palette-footer">
      <span class="kbd-hint">↑↓ navigate · ↵ open · esc close</span>
      <span class="result-count">
        {#if results.length > 0}
          <span class="nums">{results.length}</span>
          {results.length === 1 ? 'result' : 'results'}
        {/if}
      </span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(20, 14, 6, 0.45);
    backdrop-filter: blur(2px);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 15vh 32px 32px;
  }

  /* §10.2 palette shell — wider (640px) with the §10 dialog look. */
  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    width: 640px;
    max-width: 100%;
    max-height: 60vh;
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-sans);
    color: var(--text);
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 16px;
    outline: none;
    padding: 0;
  }
  .input::placeholder {
    color: var(--text-muted);
  }
  .input-kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 2px 6px;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-faint);
    flex-shrink: 0;
  }

  .scope-row {
    display: flex;
    gap: 6px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .scope-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 11px;
    cursor: pointer;
  }
  .scope-chip:hover { background: color-mix(in oklch, var(--text) 4%, transparent); }
  .scope-chip.active {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 45%, var(--border));
    background: color-mix(in oklch, var(--accent) 10%, transparent);
  }
  .scope-count {
    font-family: var(--font-mono);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .scope-chip.active .scope-count { color: var(--accent); }

  .goto-results {
    list-style: none;
    overflow-y: auto;
    padding: 4px 0;
    margin: 0;
    flex: 1;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 16px;
    border: none;
    border-left: 2px solid transparent;
    background: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .result-item.selected {
    background: color-mix(in oklch, var(--accent) 12%, transparent);
    border-left-color: var(--accent);
  }

  .result-body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 10px;
    overflow: hidden;
  }
  .result-name {
    font-size: 13.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result-item.selected .result-name {
    font-weight: 500;
  }
  .result-path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 1;
  }
  .result-meta {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    margin-left: auto;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .no-results {
    padding: 24px;
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
    font-style: italic;
  }

  .palette-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  .kbd-hint {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .result-count {
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .nums {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
</style>
