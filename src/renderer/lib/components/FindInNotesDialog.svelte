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
  import Icon from './Icon.svelte';
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

  // Intentional one-time seed from `initialMode`; dialog is short-lived and keyed.
  // svelte-ignore state_referenced_locally
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
  let focused = $state(false);

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
  <div class="dialog" role="dialog" aria-modal="true">
    <!-- Header: segmented mode toggle + close (§10.3) -->
    <div class="header">
      <div class="segmented" role="tablist" aria-label="Find mode">
        <button
          role="tab"
          class="segment"
          class:active={mode === 'find'}
          aria-selected={mode === 'find'}
          onclick={() => mode = 'find'}
        >Find</button>
        <button
          role="tab"
          class="segment"
          class:active={mode === 'replace'}
          aria-selected={mode === 'replace'}
          onclick={() => mode = 'replace'}
        >Find &amp; Replace</button>
      </div>
      <span class="header-spacer"></span>
      {#if results.length > 0 && !searching}
        {@const totalMatches = results.reduce((n, r) => n + r.matches.length, 0)}
        <span class="header-stat">
          <strong>{totalMatches}</strong> matches · <strong>{results.length}</strong> files
        </span>
      {/if}
      <button class="icon-btn" onclick={onClose} title="Close (Esc)" aria-label="Close">
        <Icon name="close" size={12} />
      </button>
    </div>

    <!-- Inputs: pattern with inline flag buttons; replacement when in replace mode -->
    <div class="inputs">
      <div class="input-shell" class:focused>
        <Icon name="search" size={13} color="var(--text-muted)" />
        <input
          bind:this={patternInput}
          bind:value={pattern}
          onfocus={() => focused = true}
          onblur={() => focused = false}
          type="text"
          class="input"
          placeholder="Find in notes…"
        />
        <div class="flag-buttons" role="group" aria-label="Search flags">
          <button
            type="button"
            class="flag-btn"
            class:on={caseSensitive}
            onclick={() => caseSensitive = !caseSensitive}
            title="Match case"
            aria-pressed={caseSensitive}
          >Aa</button>
          <button
            type="button"
            class="flag-btn"
            class:on={regex}
            onclick={() => regex = !regex}
            title="Regular expression"
            aria-pressed={regex}
          >.*</button>
        </div>
      </div>
      {#if mode === 'replace'}
        <div class="input-shell">
          <Icon name="forward" size={13} color="var(--text-muted)" />
          <input
            bind:value={replacement}
            type="text"
            class="input"
            placeholder="Replace with…"
          />
        </div>
      {/if}
    </div>

    {#if mode === 'replace' && results.length > 0 && !searching}
      <div class="replace-actions">
        <button class="btn ghost" disabled={replacing} onclick={() => doReplace(true)}>Replace Selected</button>
        <button class="btn primary" disabled={replacing} onclick={() => doReplace(false)}>Replace All</button>
      </div>
    {/if}

    {#if searching || (statusMsg && results.length === 0)}
      <div class="status">{searching ? 'Searching…' : statusMsg}</div>
    {/if}

    <div class="results">
      {#each results as file (file.relativePath)}
        {@const state = fileCheckState(file.relativePath, file.matches)}
        {@const collapsedFile = collapsed.has(file.relativePath)}
        <div class="file-group">
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div class="file-header" onclick={() => toggleCollapsed(file.relativePath)}>
            <span class="caret">
              <Icon name={collapsedFile ? 'chevronRight' : 'chevronDown'} size={11} color="var(--text-faint)" />
            </span>
            {#if mode === 'replace'}
              <input
                type="checkbox"
                class="file-check"
                checked={state === 'all'}
                indeterminate={state === 'some'}
                onchange={() => toggleFile(file.relativePath, file.matches)}
                onclick={(e) => e.stopPropagation()}
              />
            {/if}
            <Icon name="notes" size={12} color="var(--text-faint)" />
            <span class="file-path">{file.relativePath}</span>
            <span class="file-count">{file.matches.length}</span>
          </div>
          {#if !collapsedFile}
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

    <footer class="card-footer">
      <span class="kbd-hint">↑↓ next · ↵ open · esc close</span>
      {#if statusMsg && results.length > 0}
        <span class="footer-stat">{statusMsg}</span>
      {/if}
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(20, 14, 6, 0.5);
    backdrop-filter: blur(2px);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 8vh 32px 32px;
  }
  .dialog {
    width: 720px;
    max-width: 100%;
    max-height: calc(100vh - 64px);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-sans);
    color: var(--text);
  }

  /* Header: segmented mode toggle + stats + close (§10.3) */
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    border-bottom: 1px solid var(--border);
  }
  .segmented {
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 7px;
  }
  .segment {
    padding: 4px 12px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 12px;
    font-weight: 450;
    cursor: pointer;
  }
  .segment:hover:not(.active) {
    color: var(--text);
  }
  .segment.active {
    background: var(--bg-elev);
    color: var(--text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
  .header-spacer { flex: 1; }
  .header-stat {
    font-size: 11.5px;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
  .header-stat strong {
    color: var(--accent);
    font-weight: 600;
  }
  .icon-btn {
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover {
    background: color-mix(in oklch, var(--text) 8%, transparent);
    color: var(--text);
  }

  /* Inputs: search-shell with leading icon + inline flag buttons */
  .inputs {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 18px 12px;
  }
  .input-shell {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 12px;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 7px;
  }
  .input-shell.focused {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent);
  }
  .input {
    flex: 1;
    padding: 4px 0;
    border: none;
    background: transparent;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    outline: none;
  }
  .flag-buttons {
    display: inline-flex;
    gap: 2px;
  }
  .flag-btn {
    padding: 3px 7px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
  }
  .flag-btn:hover { color: var(--text); }
  .flag-btn.on {
    color: var(--accent);
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    border-color: color-mix(in oklch, var(--accent) 30%, transparent);
  }

  /* Replace action bar */
  .replace-actions {
    display: flex;
    gap: 6px;
    padding: 0 18px 12px;
    justify-content: flex-end;
  }
  .btn {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 5px;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .btn.ghost {
    background: transparent;
    color: var(--text-muted);
  }
  .btn.ghost:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .btn.primary:hover:not(:disabled) { opacity: 0.92; }
  .btn:disabled { opacity: 0.4; cursor: default; }

  .status {
    padding: 0 18px 8px;
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }

  /* Results — file accordion */
  .results {
    flex: 1;
    overflow-y: auto;
    border-top: 1px solid var(--border);
  }
  .file-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 18px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-sans);
    font-size: 12.5px;
    cursor: pointer;
  }
  .file-header:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
  }
  .caret {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    flex-shrink: 0;
  }
  .file-check {
    accent-color: var(--accent);
    flex-shrink: 0;
  }
  .file-path {
    flex: 1;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .match-list { list-style: none; padding: 0; margin: 0; }
  .match {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 18px 3px 36px;
  }
  .match-check {
    accent-color: var(--accent);
    flex-shrink: 0;
  }
  .match-jump {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex: 1;
    padding: 3px 6px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    overflow: hidden;
  }
  .match-jump:hover { background: color-mix(in oklch, var(--accent) 6%, transparent); }
  .loc {
    flex-shrink: 0;
    min-width: 52px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  .excerpt {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  .excerpt mark {
    background: color-mix(in oklch, var(--accent) 30%, transparent);
    color: var(--text);
    padding: 0 2px;
    border-radius: 2px;
    font-weight: 600;
  }
  .ctx { color: var(--text-muted); }
  .arrow {
    color: var(--text-faint);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }
  .preview { color: var(--accent); }

  /* Footer kbd hints */
  .card-footer {
    display: flex;
    align-items: center;
    padding: 10px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
  }
  .kbd-hint {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .footer-stat {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
</style>
