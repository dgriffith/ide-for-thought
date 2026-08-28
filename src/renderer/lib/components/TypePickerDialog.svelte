<script lang="ts">
  /**
   * "Treat this note as a…" type picker (#1067). A lightweight typeahead over
   * the registry's types; picking one promotes the active note to that type.
   * Modeled on SnippetPickerDialog.
   *
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and backdrop-click
   * are Dialog's job. Arrow-key navigation and Enter-to-apply stay on the
   * filter input directly: focus never leaves it in normal use (result rows
   * are selected by mouse-hover or the arrow keys, never by Tab), so this is
   * behaviorally identical to the old dialog-wide handler.
   */
  import type { TypeInfo } from '../../../shared/objects/type-def';
  import Dialog from './ui/Dialog.svelte';

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
    }
  }
</script>

<Dialog width={440} zIndex="var(--z-spawned)" onClose={onCancel} titleId="type-picker-title">
  {#snippet eyebrow()}Treat as{/snippet}
  {#snippet title()}Treat this note as a type{/snippet}
  {#snippet body()}
    <input bind:this={inputEl} bind:value={query} onkeydown={handleKeydown} type="text" class="input" placeholder="Filter types…" autocomplete="off" />

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
  {/snippet}
  {#snippet footerLeft()}<span class="kbd-hint">esc · cancel · ↑↓ · ↵ apply</span>{/snippet}
</Dialog>

<style>
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
  .kbd-hint { font-size: 10.5px; color: var(--text-faint); font-family: var(--font-mono); }
</style>
