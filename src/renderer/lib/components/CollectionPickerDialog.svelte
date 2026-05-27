<script lang="ts">
  import type { Collection } from '../../../shared/types';
  import Icon from './Icon.svelte';

  interface Props {
    collections: Collection[];
    onSelect: (collectionId: string) => void;
    onCancel: () => void;
    title: string;
    placeholder?: string;
    /** When provided, an inline "Create new collection: <query>" row
     *  appears whenever the typed name doesn't match an existing
     *  collection. Activating it creates the collection, then the
     *  dialog auto-selects the new id — one-shot "make + pick"
     *  without bouncing through a separate modal. (#470) */
    onCreate?: (name: string) => Promise<string>;
  }

  let { collections, onSelect, onCancel, title, placeholder = 'Filter collections…', onCreate }: Props = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement>();
  /** Set while we're awaiting onCreate so the user can't trigger a
   *  duplicate during the round-trip. */
  let creating = $state(false);

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

  /** Whether to offer the "create new" affordance. We hide it when
   *  the typed name is identical (case-insensitive) to an existing
   *  collection — picking the existing one is what the user
   *  probably wants. */
  const canCreate = $derived.by(() => {
    if (!onCreate) return false;
    const q = query.trim();
    if (!q) return false;
    const lower = q.toLowerCase();
    return !collections.some((c) => c.name.toLowerCase() === lower);
  });

  /** When canCreate is true, the create row sits at index 0 and the
   *  existing results are offset by 1. Keep this derivation in one
   *  place so keyboard nav doesn't drift from the rendered list. */
  const createRowOffset = $derived(canCreate ? 1 : 0);
  const itemCount = $derived(results.length + createRowOffset);

  async function activateCreate(): Promise<void> {
    if (!onCreate || creating) return;
    creating = true;
    try {
      const newId = await onCreate(query.trim());
      onSelect(newId);
    } catch (err) {
      console.error('[minerva] CollectionPickerDialog: create failed:', err);
    } finally {
      creating = false;
    }
  }

  $effect(() => {
    itemCount;
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
      selectedIndex = Math.min(selectedIndex + 1, Math.max(0, itemCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (canCreate && selectedIndex === 0) {
        void activateCreate();
        return;
      }
      const picked = results[selectedIndex - createRowOffset];
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
    {#if itemCount > 0}
      <ul class="cp-results">
        {#if canCreate}
          <li>
            <button
              class="result-item create-row"
              class:selected={selectedIndex === 0}
              disabled={creating}
              onclick={() => void activateCreate()}
              onmouseenter={() => { selectedIndex = 0; }}
            >
              <Icon name="plus" size={12} color={selectedIndex === 0 ? 'var(--accent)' : 'var(--text-faint)'} />
              <span class="result-name">
                <span class="create-prefix">Create new collection:</span>
                <span class="create-name">{query.trim()}</span>
              </span>
            </button>
          </li>
        {/if}
        {#each results as c, i (c.id)}
          {@const rowIndex = i + createRowOffset}
          <li>
            <button
              class="result-item"
              class:selected={rowIndex === selectedIndex}
              onclick={() => onSelect(c.id)}
              onmouseenter={() => { selectedIndex = rowIndex; }}
            >
              <span class="result-name">{labels.get(c.id) ?? c.name}</span>
              <span class="result-count">{c.members.length}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if collections.length === 0 && !onCreate}
      <div class="no-results">No collections yet. Create one from the Sources panel first.</div>
    {:else if collections.length === 0}
      <div class="no-results">No collections yet. Type a name to create one.</div>
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
  .create-row .create-prefix {
    color: var(--text-faint);
    margin-right: 6px;
  }
  .create-row .create-name {
    color: var(--text);
    font-weight: 500;
  }
  .create-row.selected .create-prefix {
    color: color-mix(in oklch, var(--accent) 70%, var(--text-muted));
  }
  .create-row:disabled { opacity: 0.6; cursor: default; }
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
