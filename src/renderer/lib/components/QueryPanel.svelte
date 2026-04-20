<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
  import { EditorState, Compartment } from '@codemirror/state';
  import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
  import {
    bracketMatching,
    indentUnit,
    StreamLanguage,
    syntaxHighlighting,
    HighlightStyle,
  } from '@codemirror/language';
  import { tags as t } from '@lezer/highlight';
  import { sparql } from '@codemirror/legacy-modes/mode/sparql';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { getEffectiveTheme, getThemeMode } from '../theme';
  import type { QueryTab } from '../stores/editor.svelte';
  import { api } from '../ipc/client';

  function toCsv(columns: string[], rows: Record<string, string>[]): string {
    const escape = (s: string) => {
      if (s.includes('"') || s.includes(',') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const header = columns.map(escape).join(',');
    const body = rows.map((row) => columns.map((col) => escape(row[col] ?? '')).join(','));
    return [header, ...body].join('\n');
  }

  interface Props {
    tab: QueryTab;
    onQueryChange: (text: string) => void;
    onExecute: () => void;
    onSave: () => void;
  }

  let { tab, onQueryChange, onExecute, onSave }: Props = $props();

  let editorContainer = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  let splitRatio = $state(0.4); // 40% editor, 60% results
  let dragging = $state(false);
  let containerEl = $state<HTMLDivElement>();

  // Compartments for reconfigurable extensions.
  const themeCompartment = new Compartment();

  function cmTheme(): any {
    return getEffectiveTheme(getThemeMode()) === 'dark' ? oneDark : [];
  }

  // Custom SPARQL palette — Catppuccin Mocha-inspired, with deliberately wide
  // hue distance so the four things you scan for in a query (keywords, variables,
  // IRIs/prefixed names, string literals) land on four different points of the
  // color wheel: purple, yellow, sky, green. Overrides both defaultHighlightStyle
  // and oneDark's SPARQL-relevant tag bindings.
  const sparqlHighlight = HighlightStyle.define([
    // Clause keywords (SELECT, WHERE, PREFIX, FILTER, ORDER BY, …): purple.
    { tag: t.keyword, color: '#cba6f7', fontWeight: '600' },
    // Variables (?x, $y): yellow.
    { tag: [t.variableName, t.labelName], color: '#f9e2af' },
    // IRIs + prefixed names (<http://…>, minerva:Note) surface as `atom` in
    // the legacy SPARQL parser; map them to sky blue.
    { tag: t.atom, color: '#89dceb' },
    // Built-in functions (str, lang, count, regex, …): a lighter blue to
    // separate them from the sky-blue IRIs.
    { tag: [t.standard(t.variableName), t.function(t.variableName)], color: '#89b4fa' },
    // Quoted literals: green.
    { tag: t.string, color: '#a6e3a1' },
    // Numbers: peach (SPARQL mode rarely emits these but included for
    // completeness in case a number literal shows up).
    { tag: t.number, color: '#fab387' },
    // Language tags / directives (@en, @base): teal.
    { tag: t.meta, color: '#94e2d5' },
    // Operators (*, +, <, =, !): default text.
    { tag: t.operator, color: 'inherit' },
    // Brackets + punctuation: slightly muted so structure recedes.
    { tag: [t.bracket, t.punctuation], color: '#9399b2' },
    // Comments: italic grey.
    { tag: t.comment, color: '#6c7086', fontStyle: 'italic' },
  ]);

  /** Replace the editor contents with `text` without triggering the onQueryChange callback. */
  function setDoc(text: string): void {
    if (!view) return;
    if (view.state.doc.toString() === text) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  }

  function buildState(initial: string): EditorState {
    return EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        indentUnit.of('  '),
        StreamLanguage.define(sparql),
        // Custom non-fallback highlighter so keywords / variables / IRIs /
        // strings each get a distinct color regardless of theme.
        syntaxHighlighting(sparqlHighlight),
        placeholder('SELECT ?note ?title WHERE {\n  ?note a minerva:Note ;\n        dc:title ?title .\n}'),
        themeCompartment.of(cmTheme()),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-content': {
            fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
            fontSize: '13px',
            lineHeight: '1.5',
          },
          '.cm-scroller': { overflow: 'auto' },
        }),
        keymap.of([
          { key: 'Mod-Enter', run: () => { onExecute(); return true; } },
          { key: 'Mod-s', run: () => { onSave(); return true; } },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            onQueryChange(u.state.doc.toString());
          }
        }),
      ],
    });
  }

  onMount(() => {
    if (!editorContainer) return;
    view = new EditorView({
      state: buildState(tab.query),
      parent: editorContainer,
    });
    view.focus();
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });

  // Keep the editor in sync when the active tab changes (tab switch, stock
  // query load, programmatic reset). Skips the round-trip when the user
  // just typed the change themselves.
  $effect(() => {
    const next = tab.query;
    if (view && view.state.doc.toString() !== next) {
      setDoc(next);
    }
  });

  export function updateTheme(): void {
    view?.dispatch({ effects: themeCompartment.reconfigure(cmTheme()) });
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
      <button
        class="save-query-btn"
        onclick={onSave}
        title="Save query"
      >Save</button>
      {#if tab.executionTime != null}
        <span class="status-text">
          {tab.results ? `${tab.results.length} result${tab.results.length !== 1 ? 's' : ''}` : 'Error'}
          in {tab.executionTime}ms
        </span>
      {/if}
    </div>
    <div bind:this={editorContainer} class="query-input"></div>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="split-handle" onmousedown={startDrag} class:dragging></div>

  <div class="query-results" style:height="{(1 - splitRatio) * 100}%">
    {#if tab.results && tab.results.length > 0}
      <div class="results-toolbar">
        <span class="results-count">{tab.results.length} row{tab.results.length !== 1 ? 's' : ''}</span>
        <div class="toolbar-actions">
          <button
            class="export-btn"
            onclick={() => {
              const block = `:::query-list\n${tab.query.trim()}\n:::`;
              navigator.clipboard.writeText(block);
            }}
            title="Copy a :::query-list directive to paste into a note"
          >Copy as List</button>
          <button
            class="export-btn"
            onclick={() => {
              const cols = tab.columns.join(', ');
              const linkCol = tab.columns.includes('path') ? 'path' : '';
              const config = linkCol ? `columns: ${cols}\nlink: ${linkCol}\n---\n` : `columns: ${cols}\n---\n`;
              const block = `:::query-table\n${config}${tab.query.trim()}\n:::`;
              navigator.clipboard.writeText(block);
            }}
            title="Copy a :::query-table directive to paste into a note"
          >Copy as Table</button>
          <button
            class="export-btn"
            onclick={() => api.export.csv(toCsv(tab.columns, tab.results!))}
          >Export CSV</button>
        </div>
      </div>
    {/if}
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

  .save-query-btn {
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }

  .save-query-btn:hover {
    background: var(--bg-button-hover);
  }

  .status-text {
    font-size: 11px;
    color: var(--text-muted);
  }

  .query-input {
    flex: 1;
    width: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--bg);
  }

  .query-input :global(.cm-editor) {
    height: 100%;
    outline: none;
  }

  .query-input :global(.cm-editor.cm-focused) {
    outline: none;
  }

  .query-input :global(.cm-gutters) {
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    color: var(--text-muted);
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

  .results-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .results-count {
    font-size: 11px;
    color: var(--text-muted);
  }

  .toolbar-actions {
    display: flex;
    gap: 4px;
  }

  .export-btn {
    padding: 2px 10px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
  }

  .export-btn:hover {
    background: var(--bg-button-hover);
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
