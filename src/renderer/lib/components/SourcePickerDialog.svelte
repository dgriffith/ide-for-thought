<script lang="ts">
  import type { SourceMetadata } from '../../../shared/types';
  import { displaySourceTitle } from '../../../shared/source-display';
  import Icon from './Icon.svelte';

  interface Props {
    sources: SourceMetadata[];
    onSelect: (sourceId: string) => void;
    onCancel: () => void;
    /** Title in the dialog header. */
    title: string;
    /** Placeholder in the filter input. */
    placeholder?: string;
    /** Drop a single sourceId from the candidate list — used by Merge
     *  Sources so the user can't pick the source as its own merge target. */
    excludeSourceId?: string;
  }

  let { sources, onSelect, onCancel, title, placeholder = 'Filter sources…', excludeSourceId }: Props = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement>();

  const candidates = $derived(
    excludeSourceId ? sources.filter((s) => s.sourceId !== excludeSourceId) : sources,
  );

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((s) => {
      const title = displaySourceTitle(s).toLowerCase();
      const byline = s.creators.join(' ').toLowerCase();
      const year = s.year ?? '';
      return title.includes(q) || byline.includes(q) || year.includes(q) || s.sourceId.toLowerCase().includes(q);
    });
  });

  $effect(() => {
    results; // re-track
    selectedIndex = 0;
  });

  $effect(() => {
    inputEl?.focus();
  });

  $effect(() => {
    const el = document.querySelector('.sp-results .selected');
    el?.scrollIntoView({ block: 'nearest' });
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
      if (picked) onSelect(picked.sourceId);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }

  function formatCreators(creators: string[]): string {
    if (creators.length === 0) return '';
    if (creators.length === 1) return creators[0]!;
    if (creators.length === 2) return `${creators[0]} and ${creators[1]}`;
    return `${creators[0]} et al.`;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={title}>
    <div class="header">{title}</div>
    <div class="input-row">
      <Icon name="search" size={14} color="var(--text-muted)" />
      <input bind:this={inputEl} bind:value={query} type="text" class="input" {placeholder} />
    </div>

    {#if results.length > 0}
      <ul class="sp-results">
        {#each results as s, i (s.sourceId)}
          {@const who = formatCreators(s.creators)}
          <li>
            <button
              class="result-item"
              class:selected={i === selectedIndex}
              onclick={() => onSelect(s.sourceId)}
              onmouseenter={() => { selectedIndex = i; }}
            >
              <Icon name="sites" size={13} color={i === selectedIndex ? 'var(--accent)' : 'var(--text-faint)'} />
              <span class="result-body">
                <span class="result-title">{displaySourceTitle(s)}</span>
                {#if who || s.year}
                  <span class="result-byline">
                    {#if who}{who}{/if}{#if who && s.year} · {/if}{#if s.year}<span class="year">{s.year}</span>{/if}
                  </span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if query.trim()}
      <div class="no-results">No matching sources</div>
    {:else}
      <div class="no-results">No other sources to pick from.</div>
    {/if}

    <footer class="palette-footer">
      <span class="kbd-hint">↑↓ navigate · ↵ select · esc cancel</span>
      <span class="result-count">
        {#if results.length > 0}
          <span class="nums">{results.length}</span>
          {results.length === 1 ? 'source' : 'sources'}
        {/if}
      </span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: var(--scrim-bg);
    backdrop-filter: var(--scrim-blur);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 15vh 32px 32px;
  }
  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    width: 640px;
    max-width: 100%;
    max-height: 60vh;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-sans);
    color: var(--text);
  }
  .header {
    padding: 12px 16px 6px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 16px 12px;
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
  .input::placeholder { color: var(--text-muted); }
  .sp-results {
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
    flex-direction: column;
    overflow: hidden;
  }
  .result-title {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 13.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result-byline {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 2px;
  }
  .result-byline .year {
    font-family: var(--font-mono);
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
  .result-count { font-size: 10.5px; color: var(--text-faint); }
  .nums {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
</style>
