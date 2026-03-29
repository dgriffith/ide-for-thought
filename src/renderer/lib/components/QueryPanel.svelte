<script lang="ts">
  import type { QueryTab } from '../stores/editor.svelte';

  interface Props {
    tab: QueryTab;
    onQueryChange: (text: string) => void;
    onExecute: () => void;
  }

  let { tab, onQueryChange, onExecute }: Props = $props();

  let textareaEl = $state<HTMLTextAreaElement>();
  let splitRatio = $state(0.4); // 40% editor, 60% results
  let dragging = $state(false);
  let containerEl = $state<HTMLDivElement>();

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onExecute();
    }
    // Tab inserts two spaces in the query editor
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaEl;
      if (ta) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const value = ta.value;
        ta.value = value.substring(0, start) + '  ' + value.substring(end);
        ta.selectionStart = ta.selectionEnd = start + 2;
        onQueryChange(ta.value);
      }
    }
  }

  function startDrag(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    const onMove = (me: MouseEvent) => {
      if (!containerEl) return;
      const rect = containerEl.getBoundingClientRect();
      splitRatio = Math.max(0.15, Math.min(0.85, (me.clientY - rect.top) / rect.height));
    };
    const onUp = () => {
      dragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Sort state
  let sortColumn = $state<string | null>(null);
  let sortAsc = $state(true);

  function toggleSort(col: string) {
    if (sortColumn === col) {
      sortAsc = !sortAsc;
    } else {
      sortColumn = col;
      sortAsc = true;
    }
  }

  let sortedResults = $derived(() => {
    if (!tab.results) return [];
    if (!sortColumn) return tab.results;
    const col = sortColumn;
    const dir = sortAsc ? 1 : -1;
    return [...tab.results].sort((a, b) => {
      const av = a[col] ?? '';
      const bv = b[col] ?? '';
      return av.localeCompare(bv) * dir;
    });
  });

  $effect(() => {
    if (textareaEl) textareaEl.focus();
  });
</script>

<div class="query-panel" bind:this={containerEl}>
  <div class="query-editor" style:height="{splitRatio * 100}%">
    <div class="editor-toolbar">
      <button
        class="run-btn"
        onclick={onExecute}
        disabled={tab.executing}
        title="Run query (Cmd+Enter)"
      >
        {tab.executing ? 'Running...' : 'Run'}
      </button>
      {#if tab.executionTime != null}
        <span class="status-text">
          {tab.results ? `${tab.results.length} result${tab.results.length !== 1 ? 's' : ''}` : 'Error'}
          in {tab.executionTime}ms
        </span>
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <textarea
      bind:this={textareaEl}
      class="query-input"
      value={tab.query}
      oninput={(e) => onQueryChange((e.target as HTMLTextAreaElement).value)}
      onkeydown={handleKeydown}
      placeholder="SELECT ?note ?title WHERE &#123;&#10;  ?note a <https://minerva.dev/ontology#Note> .&#10;  ?note <http://purl.org/dc/terms/title> ?title .&#10;&#125;"
      spellcheck={false}
    ></textarea>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="split-handle" onmousedown={startDrag} class:dragging></div>

  <div class="query-results" style:height="{(1 - splitRatio) * 100}%">
    {#if tab.error}
      <div class="error">{tab.error}</div>
    {:else if tab.results && tab.results.length > 0}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              {#each tab.columns as col}
                <th onclick={() => toggleSort(col)} class:sorted={sortColumn === col}>
                  {col}
                  {#if sortColumn === col}
                    <span class="sort-arrow">{sortAsc ? '▲' : '▼'}</span>
                  {/if}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each sortedResults() as row}
              <tr>
                {#each tab.columns as col}
                  <td>{row[col] ?? ''}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if tab.results}
      <div class="no-results">No results</div>
    {:else if !tab.executing}
      <div class="no-results">Run a query to see results</div>
    {/if}
  </div>
</div>

<style>
  .query-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .query-editor {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 60px;
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .run-btn {
    padding: 3px 14px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: var(--accent);
    color: var(--bg);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .run-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .run-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .status-text {
    font-size: 11px;
    color: var(--text-muted);
  }

  .query-input {
    flex: 1;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: var(--bg);
    color: var(--text);
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 13px;
    line-height: 1.5;
    resize: none;
    outline: none;
    tab-size: 2;
  }

  .query-input::placeholder {
    color: var(--text-muted);
    opacity: 0.6;
  }

  .split-handle {
    height: 4px;
    background: var(--border);
    cursor: row-resize;
    flex-shrink: 0;
  }

  .split-handle:hover,
  .split-handle.dragging {
    background: var(--accent);
  }

  .query-results {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 40px;
  }

  .table-wrap {
    flex: 1;
    overflow: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  thead {
    position: sticky;
    top: 0;
    z-index: 1;
  }

  th {
    background: var(--bg-sidebar);
    border-bottom: 1px solid var(--border);
    padding: 5px 10px;
    text-align: left;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
  }

  th:hover {
    background: var(--bg-button);
  }

  th.sorted {
    color: var(--accent);
  }

  .sort-arrow {
    font-size: 9px;
    margin-left: 3px;
  }

  td {
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  tr:hover td {
    background: var(--bg-button);
  }

  .error {
    padding: 12px;
    color: #f38ba8;
    font-size: 12px;
    font-family: monospace;
    white-space: pre-wrap;
  }

  .no-results {
    padding: 12px;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }
</style>
