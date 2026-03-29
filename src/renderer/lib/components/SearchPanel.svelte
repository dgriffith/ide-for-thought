<script lang="ts">
  import type { SearchResult } from '../../../shared/types';
  import { api } from '../ipc/client';

  interface Props {
    onFileSelect: (relativePath: string, searchQuery?: string) => void;
  }

  let { onFileSelect }: Props = $props();

  let query = $state('');
  let results = $state<SearchResult[]>([]);
  let inputEl = $state<HTMLInputElement>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  export function focus() {
    inputEl?.focus();
    inputEl?.select();
  }

  function handleInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (!query.trim()) {
        results = [];
        return;
      }
      results = await api.search.query(query);
    }, 150);
  }

  function selectResult(result: SearchResult) {
    onFileSelect(result.relativePath, query);
  }
</script>

<div class="search-panel">
  <div class="search-input-wrap">
    <input
      bind:this={inputEl}
      type="text"
      class="search-input"
      placeholder="Search notes..."
      bind:value={query}
      oninput={handleInput}
    />
    {#if query}
      <button class="clear-btn" onclick={() => { query = ''; results = []; }}>
        &times;
      </button>
    {/if}
  </div>

  {#if results.length > 0}
    <ul class="search-results">
      {#each results as result}
        <li>
          <button class="result-item" onclick={() => selectResult(result)}>
            <span class="result-title">{result.title}</span>
            <span class="result-path">{result.relativePath}</span>
            {#if result.snippet}
              <span class="result-snippet">{result.snippet}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else if query.trim()}
    <div class="no-results">No results</div>
  {/if}
</div>

<style>
  .search-panel {
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search-input-wrap {
    position: relative;
    padding: 8px;
  }

  .search-input {
    width: 100%;
    padding: 5px 24px 5px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .clear-btn {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  }

  .clear-btn:hover {
    color: var(--text);
  }

  .search-results {
    list-style: none;
    max-height: 300px;
    overflow-y: auto;
    padding: 0 4px 4px;
  }

  .result-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    background: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    border-radius: 4px;
  }

  .result-item:hover {
    background: var(--bg-button);
  }

  .result-title {
    font-size: 12px;
    font-weight: 500;
  }

  .result-path {
    font-size: 10px;
    color: var(--text-muted);
  }

  .result-snippet {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .no-results {
    padding: 8px 16px;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
