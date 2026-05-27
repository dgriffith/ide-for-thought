<script lang="ts">
  import type { Collection } from '../../../shared/types';
  import Icon from './Icon.svelte';

  interface Props {
    collections: Collection[];
    onSelect: (collectionId: string) => void;
    onCancel: () => void;
    title: string;
    placeholder?: string;
  }

  let { collections, onSelect, onCancel, title, placeholder = 'Filter collections…' }: Props = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement>();

  /** Build the full breadcrumb path for each collection so the user can
   *  disambiguate two like-named collections under different parents. */
  const labels = $derived.by(() => {
    const byId = new Map(collections.map((c) => [c.id, c]));
    const buildLabel = (c: Collection): string => {
      const parts: string[] = [c.name];
      let cursor = c.parent;
      while (cursor) {
        const p = byId.get(cursor);
        if (!p) break;
        parts.unshift(p.name);
        cursor = p.parent;
      }
      return parts.join(' / ');
    };
    return new Map(collections.map((c) => [c.id, buildLabel(c)]));
  });

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...collections].sort((a, b) =>
      (labels.get(a.id) ?? a.name).localeCompare(labels.get(b.id) ?? b.name),
    );
    if (!q) return sorted;
    return sorted.filter((c) => (labels.get(c.id) ?? c.name).toLowerCase().includes(q));
  });

  $effect(() => {
    results;
    selectedIndex = 0;
  });
  $effect(() => { inputEl?.focus(); });
  $effect(() => {
    const el = document.querySelector('.cp-results .selected');
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
      if (picked) onSelect(picked.id);
    } else if (e.key === 'Escape') {
      onCancel();
    }
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
      <ul class="cp-results">
        {#each results as c, i (c.id)}
          <li>
            <button
              class="result-item"
              class:selected={i === selectedIndex}
              onclick={() => onSelect(c.id)}
              onmouseenter={() => { selectedIndex = i; }}
            >
              <span class="result-name">{labels.get(c.id) ?? c.name}</span>
              <span class="result-count">{c.members.length}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if collections.length === 0}
      <div class="no-results">No collections yet. Create one from the Sources panel first.</div>
    {:else}
      <div class="no-results">No matching collections.</div>
    {/if}
    <footer class="palette-footer">
      <span class="kbd-hint">↑↓ navigate · ↵ select · esc cancel</span>
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
  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    width: 520px;
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
    font-size: 15px;
    outline: none;
    padding: 0;
  }
  .input::placeholder { color: var(--text-muted); }
  .cp-results {
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
    font-size: 13px;
  }
  .result-item.selected {
    background: color-mix(in oklch, var(--accent) 12%, transparent);
    border-left-color: var(--accent);
  }
  .result-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
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
</style>
