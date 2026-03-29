<script lang="ts">
  import type { NoteFile } from '../../../shared/types';

  interface Props {
    files: NoteFile[];
    onSelect: (relativePath: string) => void;
    onCancel: () => void;
  }

  let { files, onSelect, onCancel }: Props = $props();

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

  const allNotes = flattenNotes(files);

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
  <div class="dialog">
    <input
      bind:this={inputEl}
      bind:value={query}
      type="text"
      class="input"
      placeholder="Go to note..."
    />
    {#if results.length > 0}
      <ul class="goto-results">
        {#each results as result, i}
          <li>
            <button
              class="result-item"
              class:selected={i === selectedIndex}
              onclick={() => onSelect(result.relativePath)}
              onmouseenter={() => { selectedIndex = i; }}
            >
              <span class="result-name">{result.name}</span>
              <span class="result-path">{result.relativePath}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if query.trim()}
      <div class="no-results">No matching notes</div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    justify-content: center;
    padding-top: 15vh;
  }

  .dialog {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 450px;
    max-height: 60vh;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .input {
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    outline: none;
    border-radius: 8px 8px 0 0;
  }

  .input::placeholder {
    color: var(--text-muted);
  }

  .goto-results {
    list-style: none;
    overflow-y: auto;
    padding: 4px;
    margin: 0;
  }

  .result-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    border-radius: 4px;
  }

  .result-item:hover,
  .result-item.selected {
    background: var(--bg-button);
  }

  .result-name {
    font-size: 13px;
  }

  .result-path {
    font-size: 11px;
    color: var(--text-muted);
  }

  .no-results {
    padding: 12px;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
