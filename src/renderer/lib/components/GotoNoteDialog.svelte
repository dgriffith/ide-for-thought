<script lang="ts">
  import type { NoteFile } from '../../../shared/types';
  import Icon from './Icon.svelte';

  interface Props {
    files: NoteFile[];
    onSelect: (relativePath: string) => void;
    onCancel: () => void;
    /** Placeholder text inside the search input. Default "Go to note...". */
    placeholder?: string;
    /** Drop a single relativePath from the candidate list — used by Merge
     *  Note (#464) so the user can't pick the source as the merge target. */
    excludePath?: string;
  }

  let { files, onSelect, onCancel, placeholder = 'Go to note...', excludePath }: Props = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement>();

  // Flatten the file tree into a list of note paths
  function flattenNotes(items: NoteFile[], acc: { name: string; relativePath: string }[] = []): { name: string; relativePath: string }[] {
    for (const f of items) {
      if (f.isDirectory) {
        if (f.children) flattenNotes(f.children, acc);
      } else {
        acc.push({ name: f.name.replace(/\.md$/, ''), relativePath: f.relativePath });
      }
    }
    return acc;
  }

  const allNotes = flattenNotes(files).filter((n) => n.relativePath !== excludePath);

  // ── Matching logic ──────────────────────────────────────────────────────

  function matchNotes(q: string): { name: string; relativePath: string; score: number }[] {
    if (!q.trim()) return allNotes.map((n) => ({ ...n, score: 0 }));

    // Detect regex: contains unescaped regex metacharacters
    if (/[.*+?^${}()|[\]\\]/.test(q)) {
      try {
        const re = new RegExp(q, 'i');
        return allNotes
          .filter((n) => re.test(n.name) || re.test(n.relativePath))
          .map((n) => ({ ...n, score: 1 }));
      } catch { /* fall through to fuzzy */ }
    }

    const scored: { name: string; relativePath: string; score: number }[] = [];

    for (const note of allNotes) {
      const score = scoreMatch(note.name, note.relativePath, q);
      if (score > 0) scored.push({ ...note, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  function scoreMatch(name: string, path: string, q: string): number {
    const lowerName = name.toLowerCase();
    const lowerPath = path.toLowerCase();
    const lowerQ = q.toLowerCase();

    // Exact substring in name
    if (lowerName.includes(lowerQ)) return 100;
    // Exact substring in path
    if (lowerPath.includes(lowerQ)) return 80;

    // First-letter matching: each char of query matches the first letter of a word
    if (firstLetterMatch(name, q)) return 90;

    // CamelCase matching: uppercase letters in query match uppercase transitions
    if (camelCaseMatch(name, q)) return 85;

    // Fuzzy: all chars of query appear in order in name
    if (fuzzyMatch(lowerName, lowerQ)) return 50;
    if (fuzzyMatch(lowerPath, lowerQ)) return 30;

    return 0;
  }

  function firstLetterMatch(name: string, q: string): boolean {
    // Split name into words by spaces, hyphens, underscores
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
    // Extract capital letters / word starts from name
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

  // ── Derived results ─────────────────────────────────────────────────────

  let results = $derived(matchNotes(query).slice(0, 30));

  // Reset selection when results change
  $effect(() => {
    results; // track dependency
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
      if (results[selectedIndex]) {
        onSelect(results[selectedIndex].relativePath);
      }
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }

  $effect(() => {
    inputEl?.focus();
  });

  // Keep selected item scrolled into view
  $effect(() => {
    const el = document.querySelector('.goto-results .selected');
    el?.scrollIntoView({ block: 'nearest' });
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Go to note">
    <div class="input-row">
      <Icon name="search" size={14} color="var(--text-muted)" />
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        class="input"
        {placeholder}
      />
      <span class="input-kbd">⌘ K</span>
    </div>

    {#if results.length > 0}
      <ul class="goto-results">
        {#each results as result, i}
          {@const folder = result.relativePath.includes('/')
            ? result.relativePath.slice(0, result.relativePath.lastIndexOf('/'))
            : ''}
          <li>
            <button
              class="result-item"
              class:selected={i === selectedIndex}
              onclick={() => onSelect(result.relativePath)}
              onmouseenter={() => { selectedIndex = i; }}
            >
              <Icon name="notes" size={13} color={i === selectedIndex ? 'var(--accent)' : 'var(--text-faint)'} />
              <span class="result-body">
                <span class="result-name">{result.name}</span>
                {#if folder}
                  <span class="result-path">{folder}</span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if query.trim()}
      <div class="no-results">No matching notes</div>
    {/if}

    <footer class="palette-footer">
      <span class="kbd-hint">↑↓ navigate · ↵ open · esc close</span>
      <span class="result-count">
        {#if results.length > 0}
          <span class="nums">{results.length}</span>
          {results.length === 1 ? 'note' : 'notes'}
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
