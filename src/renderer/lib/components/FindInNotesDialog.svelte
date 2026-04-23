<script lang="ts">
  /**
   * Project-wide Find / Find and Replace dialog (#306 / #307).
   *
   * One component, two modes. `initialMode` comes from the menu entry —
   * Cmd+Shift+F opens in `find`, Cmd+Shift+H opens in `replace`. User
   * can toggle between the two inside the dialog without losing state.
   *
   * Search is debounced; replace previews are the same list of matches
   * with per-row checkboxes (all checked by default). Clicking any
   * match row opens the file and jumps to the line/col.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import type {
    SearchInNotesFileResult,
    SearchInNotesMatch,
    ReplaceInNotesSelection,
  } from '../ipc/client';

  type Mode = 'find' | 'replace';

  interface Props {
    initialMode: Mode;
    onJumpTo: (relativePath: string, line: number, col: number) => void;
    onClose: () => void;
  }

  let { initialMode, onJumpTo, onClose }: Props = $props();

  let mode = $state<Mode>(initialMode);
  let pattern = $state('');
  let replacement = $state('');
  let caseSensitive = $state(false);
  let regex = $state(false);
  let results = $state<SearchInNotesFileResult[]>([]);
  let searching = $state(false);
  let replacing = $state(false);
  let statusMsg = $state('');

  // Per-match selection state, keyed by "path:line:startCol:endCol".
  let unchecked = $state<Set<string>>(new Set());
  // All files start expanded; users toggle per-file if a match list is long.
  let collapsed = $state<Set<string>>(new Set());
  let patternInput = $state<HTMLInputElement>();

  function matchKey(rel: string, m: SearchInNotesMatch): string {
    return `${rel}:${m.line}:${m.startCol}:${m.endCol}`;
  }

  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  function runSearch() {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(async () => {
      if (!pattern.trim()) {
        results = [];
        statusMsg = '';
        return;
      }
      searching = true;
      try {
        results = await api.notebase.searchInNotes({ pattern, caseSensitive, regex });
        const totalMatches = results.reduce((n, r) => n + r.matches.length, 0);
        statusMsg = results.length === 0
          ? 'No matches'
          : `${totalMatches} match${totalMatches === 1 ? '' : 'es'} in ${results.length} file${results.length === 1 ? '' : 's'}`;
        // Every newly-found match starts checked, so reset the exclusion set.
        unchecked = new Set();
      } finally {
        searching = false;
      }
    }, 200);
  }

  $effect(() => {
    // Re-run whenever any search input changes. pattern/flags are
    // reactive — the $effect just touches them here to register the
    // dependency, then defers the work into runSearch.
    pattern; caseSensitive; regex;
    runSearch();
  });

  onMount(() => { patternInput?.focus(); });

  function toggleCollapsed(rel: string) {
    if (collapsed.has(rel)) collapsed.delete(rel);
    else collapsed.add(rel);
    collapsed = new Set(collapsed);
  }

  function toggleMatch(key: string) {
    if (unchecked.has(key)) unchecked.delete(key);
    else unchecked.add(key);
    unchecked = new Set(unchecked);
  }

  function toggleFile(rel: string, matches: SearchInNotesMatch[]) {
    // If every match in the file is currently checked, uncheck them all;
    // otherwise check them all.
    const allChecked = matches.every((m) => !unchecked.has(matchKey(rel, m)));
    const next = new Set(unchecked);
    for (const m of matches) {
      const k = matchKey(rel, m);
      if (allChecked) next.add(k);
      else next.delete(k);
    }
    unchecked = next;
  }

  function fileCheckState(rel: string, matches: SearchInNotesMatch[]): 'all' | 'none' | 'some' {
    let checked = 0;
    for (const m of matches) if (!unchecked.has(matchKey(rel, m))) checked++;
    if (checked === 0) return 'none';
    if (checked === matches.length) return 'all';
    return 'some';
  }

  function selectionsFromCurrent(onlyChecked: boolean): ReplaceInNotesSelection[] {
    const out: ReplaceInNotesSelection[] = [];
    for (const r of results) {
      for (const m of r.matches) {
        if (onlyChecked && unchecked.has(matchKey(r.relativePath, m))) continue;
        out.push({ relativePath: r.relativePath, line: m.line, startCol: m.startCol, endCol: m.endCol });
      }
    }
    return out;
  }

  async function doReplace(onlyChecked: boolean) {
    if (!pattern.trim()) return;
    const selections = selectionsFromCurrent(onlyChecked);
    if (selections.length === 0) {
      statusMsg = 'Nothing selected';
      return;
    }
    replacing = true;
    try {
      const r = await api.notebase.replaceInNotes({
        pattern, caseSensitive, regex, replacement, selections,
      });
      statusMsg = `Replaced ${r.replacedCount} match${r.replacedCount === 1 ? '' : 'es'} in ${r.changedPaths.length} file${r.changedPaths.length === 1 ? '' : 's'}`;
      // Re-run the search so the UI reflects the post-replace state —
      // any still-matching hits stay, replaced ones disappear.
      runSearch();
    } finally {
      replacing = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  function excerptBefore(line: string, m: SearchInNotesMatch): string {
    return line.slice(Math.max(0, m.startCol - 40), m.startCol);
  }
  function excerptMatch(line: string, m: SearchInNotesMatch): string {
    return line.slice(m.startCol, m.endCol);
  }
  function excerptAfter(line: string, m: SearchInNotesMatch): string {
    return line.slice(m.endCol, Math.min(line.length, m.endCol + 40));
  }

  function previewLine(line: string, m: SearchInNotesMatch): string {
    // What the line looks like after replacement — used in replace mode.
    const next = line.slice(0, m.startCol) + replacement + line.slice(m.endCol);
    return next.length > 120 ? next.slice(0, 120) + '…' : next;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="dialog">
    <div class="header">
      <div class="mode-tabs">
        <button class="mode-tab" class:active={mode === 'find'} onclick={() => mode = 'find'}>Find</button>
        <button class="mode-tab" class:active={mode === 'replace'} onclick={() => mode = 'replace'}>Find &amp; Replace</button>
      </div>
      <button class="close-btn" onclick={onClose} title="Close (Esc)">×</button>
    </div>

    <div class="inputs">
      <input
        bind:this={patternInput}
        bind:value={pattern}
        type="text"
        class="input"
        placeholder="Find in notes…"
      />
      {#if mode === 'replace'}
        <input
          bind:value={replacement}
          type="text"
          class="input"
          placeholder="Replace with…"
        />
      {/if}
      <div class="flags">
        <label><input type="checkbox" bind:checked={caseSensitive} /> Aa</label>
        <label><input type="checkbox" bind:checked={regex} /> .*</label>
      </div>
    </div>

    <div class="status">
      {searching ? 'Searching…' : statusMsg}
      {#if mode === 'replace' && results.length > 0 && !searching}
        <div class="replace-actions">
          <button class="btn" disabled={replacing} onclick={() => doReplace(true)}>Replace Selected</button>
          <button class="btn" disabled={replacing} onclick={() => doReplace(false)}>Replace All</button>
        </div>
      {/if}
    </div>

    <div class="results">
      {#each results as file (file.relativePath)}
        <div class="file-group">
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div class="file-header">
            <span class="caret" onclick={() => toggleCollapsed(file.relativePath)}>
              {collapsed.has(file.relativePath) ? '▸' : '▾'}
            </span>
            {#if mode === 'replace'}
              {@const state = fileCheckState(file.relativePath, file.matches)}
              <input
                type="checkbox"
                class="file-check"
                checked={state === 'all'}
                indeterminate={state === 'some'}
                onchange={() => toggleFile(file.relativePath, file.matches)}
              />
            {/if}
            <span class="file-path" onclick={() => toggleCollapsed(file.relativePath)}>
              {file.relativePath} <span class="file-count">({file.matches.length})</span>
            </span>
          </div>
          {#if !collapsed.has(file.relativePath)}
            <ul class="match-list">
              {#each file.matches as m}
                {@const key = matchKey(file.relativePath, m)}
                <li class="match">
                  {#if mode === 'replace'}
                    <input
                      type="checkbox"
                      class="match-check"
                      checked={!unchecked.has(key)}
                      onchange={() => toggleMatch(key)}
                    />
                  {/if}
                  <button class="match-jump" onclick={() => onJumpTo(file.relativePath, m.line, m.startCol)}>
                    <span class="loc">{m.line}:{m.startCol + 1}</span>
                    <span class="excerpt">
                      <span class="ctx">{excerptBefore(m.lineText, m)}</span><mark>{excerptMatch(m.lineText, m)}</mark><span class="ctx">{excerptAfter(m.lineText, m)}</span>
                    </span>
                    {#if mode === 'replace'}
                      <span class="arrow">→</span>
                      <span class="excerpt preview">{previewLine(m.lineText, m)}</span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    padding-top: 8vh;
  }
  .dialog {
    width: min(720px, 90vw);
    max-height: 80vh;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .mode-tabs { display: flex; gap: 4px; }
  .mode-tab {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
  }
  .mode-tab.active { background: var(--bg-button-hover); color: var(--text); }
  .close-btn {
    padding: 2px 10px;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .inputs { display: flex; flex-direction: column; gap: 4px; }
  .input {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    outline: none;
  }
  .input:focus { border-color: var(--accent); }
  .flags {
    display: flex;
    gap: 12px;
    padding: 2px 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .flags label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  .status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: var(--text-muted);
    padding: 0 2px;
  }
  .replace-actions { display: flex; gap: 6px; }
  .btn {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
    font-size: 12px;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) { opacity: 0.9; }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .results {
    flex: 1;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
  }
  .file-group {}
  .file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--bg-sidebar);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    cursor: default;
  }
  .caret { cursor: pointer; color: var(--text-muted); width: 12px; text-align: center; }
  .file-path { flex: 1; color: var(--text); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-count { color: var(--text-muted); }
  .match-list { list-style: none; padding: 0; margin: 0; }
  .match {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px 2px 28px;
    border-bottom: 1px solid var(--border);
  }
  .match:last-child { border-bottom: none; }
  .match-jump {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex: 1;
    padding: 2px 0;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
  }
  .match-jump:hover { background: var(--bg-button); }
  .loc {
    flex-shrink: 0;
    min-width: 48px;
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }
  .excerpt {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }
  .excerpt mark { background: var(--accent); color: var(--bg); padding: 0 1px; border-radius: 2px; }
  .ctx { color: var(--text-muted); }
  .arrow { color: var(--text-muted); }
  .preview { color: var(--text); opacity: 0.8; }
</style>
