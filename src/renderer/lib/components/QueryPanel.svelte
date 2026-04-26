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
  import { sql, PostgreSQL } from '@codemirror/lang-sql';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { getEffectiveTheme, getThemeMode } from '../theme';
  import type { QueryTab, QueryLanguage } from '../stores/editor.svelte';
  import { api } from '../ipc/client';
  import { formatSparql } from '../../../shared/sparql-format';
  import { formatSql } from '../../../shared/sql-format';
  import { autocompletion, acceptCompletion } from '@codemirror/autocomplete';
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
    onLanguageChange: (language: QueryLanguage) => void;
    onExecute: () => void;
    onSave: () => void;
  }

  let { tab, onQueryChange, onLanguageChange, onExecute, onSave }: Props = $props();

  const isEmpty = $derived(tab.query.trim().length === 0);

  let editorContainer = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  let splitRatio = $state(0.4); // 40% editor, 60% results
  let dragging = $state(false);
  let containerEl = $state<HTMLDivElement>();
  let copyMenuOpen = $state(false);

  // ── Copy-as helpers ───────────────────────────────────────────────────────
  // Each builder returns a string ready to paste into a note. SPARQL tabs
  // omit `language:` (it's the directive default); SQL tabs include it so
  // Preview.svelte's query-block executor routes them through DuckDB.

  function copyAsList(): void {
    const header = tab.language === 'sql' ? 'language: sql\n---\n' : '';
    const block = `:::query-list\n${header}${tab.query.trim()}\n:::`;
    void navigator.clipboard.writeText(block);
    copyMenuOpen = false;
  }

  function copyAsTable(): void {
    const cols = tab.columns.join(', ');
    // link: is a SPARQL convention (column named 'path' becomes a wiki-link);
    // skip the auto-detect on SQL results to avoid wrapping arbitrary string
    // columns that happen to be named 'path'.
    const linkCol = tab.language === 'sparql' && tab.columns.includes('path') ? 'path' : '';
    const langLine = tab.language === 'sql' ? 'language: sql\n' : '';
    const linkLine = linkCol ? `link: ${linkCol}\n` : '';
    const config = `${langLine}columns: ${cols}\n${linkLine}---\n`;
    const block = `:::query-table\n${config}${tab.query.trim()}\n:::`;
    void navigator.clipboard.writeText(block);
    copyMenuOpen = false;
  }

  /** Paste-into-note as an executable fence (#238 shell picks it up). */
  function copyAsExecutableBlock(): void {
    const block = `\`\`\`${tab.language}\n${tab.query.trim()}\n\`\`\``;
    void navigator.clipboard.writeText(block);
    copyMenuOpen = false;
  }

  function toggleCopyMenu(): void {
    copyMenuOpen = !copyMenuOpen;
    if (copyMenuOpen) {
      // Close on the next outside click. setTimeout so the current click
      // that opened the menu doesn't immediately re-close it.
      const close = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest('.copy-as-wrap')) {
          copyMenuOpen = false;
          window.removeEventListener('click', close);
        }
      };
      setTimeout(() => window.addEventListener('click', close), 0);
    }
  }

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
  const languageCompartment = new Compartment();
  const placeholderCompartment = new Compartment();
  const completionCompartment = new Compartment();

  // SQL autocomplete schema — flat {tableName: [columnName…]} map,
  // refreshed when the language switches to SQL or a CSV lands/leaves.
  let sqlSchema = $state<Record<string, string[]>>({});

  async function refreshSqlSchema(): Promise<void> {
    try {
      const tables = await api.tables.list();
      const next: Record<string, string[]> = {};
      for (const t of tables) next[t.name] = t.columns;
      sqlSchema = next;
      // Re-seat the SQL language extension so lang-sql picks up new schema.
      if (view && tab.language === 'sql') {
        view.dispatch({ effects: languageCompartment.reconfigure(languageExt('sql')) });
      }
    } catch { /* tables DB not ready — autocomplete just falls back to keywords */ }
  }

  function languageExt(lang: QueryLanguage): any {
    if (lang === 'sql') {
      return sql({
        dialect: PostgreSQL,
        upperCaseKeywords: true,
        schema: sqlSchema,
      });
    }
    return StreamLanguage.define(sparql);
  }

  function placeholderFor(lang: QueryLanguage): string {
    return lang === 'sql'
      ? 'SELECT *\nFROM my_table\nLIMIT 10'
      : 'SELECT ?note ?title WHERE {\n  ?note a minerva:Note ;\n        dc:title ?title .\n}';
  }

  function completionFor(lang: QueryLanguage): any {
    // lang-sql bundles its own completion source via the `schema` option;
    // we only need to override for SPARQL.
    if (lang === 'sql') return autocompletion();
    return autocompletion({ override: [createSparqlCompletionSource(() => schema)] });
  }

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
        languageCompartment.of(languageExt(tab.language)),
        // Custom highlighter \u2014 dark vs light palette swapped via compartment
        // whenever the theme changes. Non-fallback so it overrides oneDark's
        // own mappings in dark mode.
        highlightCompartment.of(cmHighlight()),
        placeholderCompartment.of(placeholder(placeholderFor(tab.language))),
        completionCompartment.of(completionFor(tab.language)),
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
        Prec.highest(keymap.of([
          { key: 'Mod-Enter', run: () => { if (!isEmpty) onExecute(); return true; } },
          { key: 'Mod-s', run: () => { if (!isEmpty) onSave(); return true; } },
          { key: 'Shift-Alt-f', run: () => { if (isEmpty) return true; return reformat(); } },
          { key: 'Tab', run: acceptCompletion },
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
    void refreshSqlSchema();
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

  // React to language changes (from the dropdown here, or a programmatic
  // switch elsewhere). Swaps the parser, placeholder, and completion source.
  let lastLanguage: QueryLanguage | null = null;
  $effect(() => {
    const nextLang = tab.language;
    if (!view || nextLang === lastLanguage) return;
    lastLanguage = nextLang;
    view.dispatch({
      effects: [
        languageCompartment.reconfigure(languageExt(nextLang)),
        placeholderCompartment.reconfigure(placeholder(placeholderFor(nextLang))),
        completionCompartment.reconfigure(completionFor(nextLang)),
      ],
    });
    if (nextLang === 'sql') void refreshSqlSchema();
  });

  function handleLanguageSelect(e: Event) {
    const next = (e.currentTarget as HTMLSelectElement).value as QueryLanguage;
    onLanguageChange(next);
  }

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
    const formatted = tab.language === 'sql' ? formatSql(current) : formatSparql(current);
    if (formatted === current) return true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
    });
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
        disabled={tab.executing || isEmpty}
        title="Run query (Cmd+Enter)"
      >
        {tab.executing ? 'Running...' : 'Run'}
      </button>
      <select
        class="language-select"
        value={tab.language}
        onchange={handleLanguageSelect}
        title="Query language"
      >
        <option value="sparql">SPARQL</option>
        <option value="sql">SQL</option>
      </select>
      <button
        class="save-query-btn"
        onclick={onSave}
        disabled={isEmpty}
        title="Save query"
      >Save</button>
      <button
        class="save-query-btn"
        onclick={reformat}
        disabled={isEmpty}
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
          <div class="copy-as-wrap">
            <button
              class="export-btn copy-as-btn"
              onclick={toggleCopyMenu}
              title="Copy these results (or the query) for pasting into a note"
            >Copy as… ▾</button>
            {#if copyMenuOpen}
              <div class="copy-as-menu" role="menu">
                <button role="menuitem" onclick={copyAsList} title="Copy a :::query-list directive to paste into a note">
                  <span class="menu-label">List</span>
                  <span class="menu-hint">:::query-list</span>
                </button>
                <button role="menuitem" onclick={copyAsTable} title="Copy a :::query-table directive to paste into a note">
                  <span class="menu-label">Table</span>
                  <span class="menu-hint">:::query-table</span>
                </button>
                <button role="menuitem" onclick={copyAsExecutableBlock} title="Copy a runnable {tab.language} fence (▶ gutter icon + Cmd+Shift+Enter)">
                  <span class="menu-label">Executable block</span>
                  <span class="menu-hint">```{tab.language}</span>
                </button>
              </div>
            {/if}
          </div>
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

  .save-query-btn:hover:not(:disabled) {
    background: var(--bg-button-hover);
  }

  .save-query-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .language-select {
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }

  .language-select:hover {
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

  /* Copy-as… dropdown (#238 follow-up). */
  .copy-as-wrap {
    position: relative;
    display: inline-block;
  }

  .copy-as-menu {
    position: absolute;
    top: calc(100% + 2px);
    right: 0;
    z-index: 20;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 180px;
    display: flex;
    flex-direction: column;
  }

  .copy-as-menu button {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .copy-as-menu button:hover {
    background: var(--bg-button);
  }

  .copy-as-menu .menu-label {
    font-weight: 500;
  }

  .copy-as-menu .menu-hint {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 10px;
    color: var(--text-muted);
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
