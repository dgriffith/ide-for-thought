<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
  import { EditorState, Compartment, Prec } from '@codemirror/state';
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
  import { formatSparql } from '../../../shared/sparql-format';
  import { autocompletion, acceptCompletion, selectedCompletion } from '@codemirror/autocomplete';
  import { createSparqlCompletionSource, type SparqlSchema } from '../editor/sparql-autocomplete';

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

  // Lazy-fetched predicates / classes from the live graph for autocomplete.
  // Null until the first fetch resolves; the completion source treats that
  // as "standard prefixes only, no schema" so the panel stays usable during
  // the initial load.
  let schema: SparqlSchema | null = null;

  async function refreshSchema(): Promise<void> {
    try {
      schema = (await api.graph.schemaForCompletion()) as SparqlSchema;
    } catch { /* graph not ready \u2014 keep schema null, completion falls back */ }
  }

  // Compartments for reconfigurable extensions.
  const themeCompartment = new Compartment();
  const highlightCompartment = new Compartment();

  function isDark(): boolean {
    return getEffectiveTheme(getThemeMode()) === 'dark';
  }

  function cmTheme(): any {
    return isDark() ? oneDark : [];
  }

  // Custom SPARQL palette — Catppuccin-inspired, with deliberately wide hue
  // distance so the four things you scan for in a query (keywords, variables,
  // IRIs/prefixed names, string literals) land on four different points of
  // the color wheel. Two variants so contrast holds on both backgrounds.

  // Mocha (dark): saturated pastels that read on a dark editor.
  const sparqlHighlightDark = HighlightStyle.define([
    { tag: t.keyword, color: '#cba6f7', fontWeight: '600' },                                  // purple
    { tag: [t.variableName, t.labelName], color: '#f9e2af' },                                 // yellow
    { tag: t.atom, color: '#89dceb' },                                                        // sky
    { tag: [t.standard(t.variableName), t.function(t.variableName)], color: '#89b4fa' },     // blue
    { tag: t.string, color: '#a6e3a1' },                                                      // green
    { tag: t.number, color: '#fab387' },                                                      // peach
    { tag: t.meta, color: '#94e2d5' },                                                        // teal
    { tag: t.operator, color: 'inherit' },
    { tag: [t.bracket, t.punctuation], color: '#9399b2' },
    { tag: t.comment, color: '#6c7086', fontStyle: 'italic' },
  ]);

  // Latte (light): darker, more saturated hues so they read on white. Yellow
  // is replaced with maroon/red for variables — yellow-on-white is unreadable.
  const sparqlHighlightLight = HighlightStyle.define([
    { tag: t.keyword, color: '#8839ef', fontWeight: '600' },                                  // mauve
    { tag: [t.variableName, t.labelName], color: '#c92f5a' },                                 // deep rose
    { tag: t.atom, color: '#0370a1' },                                                        // deep sky
    { tag: [t.standard(t.variableName), t.function(t.variableName)], color: '#1e66f5' },     // blue
    { tag: t.string, color: '#2d7d1f' },                                                      // deep green
    { tag: t.number, color: '#d13f00' },                                                      // burnt orange
    { tag: t.meta, color: '#117276' },                                                        // deep teal
    { tag: t.operator, color: 'inherit' },
    { tag: [t.bracket, t.punctuation], color: '#7a7f91' },
    { tag: t.comment, color: '#6c6f85', fontStyle: 'italic' },
  ]);

  function cmHighlight(): any {
    return syntaxHighlighting(isDark() ? sparqlHighlightDark : sparqlHighlightLight);
  }

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
        // Custom highlighter \u2014 dark vs light palette swapped via compartment
        // whenever the theme changes. Non-fallback so it overrides oneDark's
        // own mappings in dark mode.
        highlightCompartment.of(cmHighlight()),
        placeholder('SELECT ?note ?title WHERE {\n  ?note a minerva:Note ;\n        dc:title ?title .\n}'),
        autocompletion({ override: [createSparqlCompletionSource(() => schema)] }),
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
        // Prec.highest so our Enter override beats autocompletion's
        // built-in Enter-accepts binding.
        Prec.highest(keymap.of([
          { key: 'Mod-Enter', run: () => { onExecute(); return true; } },
          { key: 'Mod-s', run: () => { onSave(); return true; } },
          { key: 'Shift-Alt-f', run: reformat },
          { key: 'Tab', run: acceptCompletion },
          { key: 'Enter', run: acceptAndEatRestOfWord },
        ])),
        keymap.of([
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
    // Kick off an initial schema fetch in the background. If it takes a
    // while (big graph), completion still works with standard prefixes +
    // keywords while it\u2019s pending.
    void refreshSchema();
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
    view?.dispatch({
      effects: [
        themeCompartment.reconfigure(cmTheme()),
        highlightCompartment.reconfigure(cmHighlight()),
      ],
    });
  }

  function reformat(): boolean {
    if (!view) return false;
    const current = view.state.doc.toString();
    const formatted = formatSparql(current);
    if (formatted === current) return true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
    });
    return true;
  }

  /**
   * Enter accepts the active completion, then eats any non-whitespace
   * characters that follow the cursor \u2014 useful when the cursor is
   * mid-word and you want the whole half-typed token replaced. Tab
   * still accepts in place (no eating), so you can pick between the two.
   */
  function acceptAndEatRestOfWord(v: EditorView): boolean {
    if (!selectedCompletion(v.state)) return false; // let Enter fall through to newline
    const accepted = acceptCompletion(v);
    if (!accepted) return false;
    // Post-accept: cursor sits immediately after the inserted label. Eat
    // any non-whitespace chars that remain on the line \u2014 that's the tail
    // of whatever the user had half-typed.
    const head = v.state.selection.main.head;
    const doc = v.state.doc;
    let end = head;
    while (end < doc.length) {
      const ch = doc.sliceString(end, end + 1);
      if (/\s/.test(ch)) break;
      end++;
    }
    if (end > head) {
      v.dispatch({ changes: { from: head, to: end, insert: '' } });
    }
    return true;
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
      <button
        class="save-query-btn"
        onclick={reformat}
        title="Reformat (Shift+Alt+F)"
      >Format</button>
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
