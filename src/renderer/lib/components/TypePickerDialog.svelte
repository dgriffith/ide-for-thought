<script lang="ts">
  /**
   * "Treat this note as a…" type picker (#1067). A lightweight typeahead over
   * the registry's types; picking one promotes the active note to that type.
   * Modeled on SnippetPickerDialog.
   */
  import type { TypeInfo } from '../../../shared/objects/type-def';

  interface Props {
    types: TypeInfo[];
    onPick: (type: TypeInfo) => void;
    onCancel: () => void;
  }

  let { types, onPick, onCancel }: Props = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement>();

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return types;
    return types.filter((t) => t.label.toLowerCase().includes(q) || t.id.includes(q));
  });

  $effect(() => { results; selectedIndex = 0; });
  $effect(() => { inputEl?.focus(); });
  $effect(() => { document.querySelector('.tp-results .selected')?.scrollIntoView({ block: 'nearest' }); });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) selectedIndex = (selectedIndex + 1) % results.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) selectedIndex = (selectedIndex - 1 + results.length) % results.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = results[selectedIndex];
      if (pick) onPick(pick);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true">
    <header class="card-header">
      <div class="eyebrow">Treat as</div>
      <h2 class="title">Treat this note as a type</h2>
    </header>

    <div class="body">
      <input bind:this={inputEl} bind:value={query} type="text" class="input" placeholder="Filter types…" autocomplete="off" />

      {#if types.length === 0}
        <div class="empty">No types in this project yet.</div>
      {:else if results.length === 0}
        <div class="empty">No matches.</div>
      {:else}
        <div class="tp-results" role="listbox">
          {#each results as t, i (t.id)}
            {@const selected = i === selectedIndex}
            <button
              type="button"
              class="tp-row"
              class:selected
              role="option"
              aria-selected={selected}
              onmousemove={() => { selectedIndex = i; }}
              onclick={() => onPick(t)}
            >
              <span class="tp-icon" style={t.color ? `color:${t.color}` : undefined}>{t.icon ?? '◆'}</span>
              <span class="tp-name">{t.label}</span>
              <span class="tp-fields">{t.properties.length} field{t.properties.length === 1 ? '' : 's'}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ↑↓ · ↵ apply</span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-spawned);
    background: var(--scrim-bg);
    backdrop-filter: var(--scrim-blur);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
    width: 440px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    color: var(--text);
    overflow: hidden;
  }
  .card-header { padding: 18px 22px 0; }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 5px;
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 500;
    color: var(--text);
  }
  .body { padding: 14px 22px 16px; }
  .input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--bg-inset);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    outline: none;
    box-sizing: border-box;
    margin-bottom: 10px;
  }
  .tp-results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 300px;
    overflow-y: auto;
  }
  .tp-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .tp-row.selected { background: color-mix(in oklch, var(--accent) 14%, transparent); color: var(--accent); }
  .tp-icon { width: 16px; font-size: 14px; line-height: 1; text-align: center; flex-shrink: 0; }
  .tp-name { flex: 1; font-size: 13px; font-weight: 500; }
  .tp-fields {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    flex-shrink: 0;
  }
  .tp-row.selected .tp-fields { color: var(--accent); opacity: 0.7; }
  .empty { padding: 16px 4px; font-size: 12.5px; color: var(--text-faint); text-align: center; }
  .card-footer {
    display: flex;
    align-items: center;
    padding: 10px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  .kbd-hint { font-size: 10.5px; color: var(--text-faint); font-family: var(--font-mono); }
</style>
