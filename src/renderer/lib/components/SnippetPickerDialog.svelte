<script lang="ts">
  /**
   * Snippet / fragment template picker (#475 second half). Pulls from
   * the same `.minerva/templates/` folder as the note-creation flow,
   * but instead of seeding a new file, inserts the substituted body
   * at the editor caret (optionally wrapping the current selection
   * via `{{selection}}`).
   *
   * UI is a lightweight typeahead — text input at the top, filtered
   * list below, Enter to choose, Esc to cancel. Modeled on the
   * command palette but without the recency / scoring layer; the
   * template list is short enough that substring filter is enough.
   *
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and
   * backdrop-click are Dialog's job. Arrow-key nav and Enter-to-insert
   * stay on the filter input directly: focus never leaves it in normal
   * use (result rows are chosen by mouse-hover or the arrow keys, never
   * Tab), so this is behaviorally identical to the old dialog-wide handler.
   */
  import type { TemplateInfo } from '../ipc/client';
  import Icon from './Icon.svelte';
  import Dialog from './ui/Dialog.svelte';

  interface Props {
    templates: TemplateInfo[];
    onPick: (template: TemplateInfo) => void;
    onCancel: () => void;
  }

  let { templates, onPick, onCancel }: Props = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement>();

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.name.toLowerCase().includes(q));
  });

  $effect(() => {
    // Reset selection when the result set changes — keeps the
    // highlight on the first match as the user narrows.
    results;
    selectedIndex = 0;
  });

  $effect(() => { inputEl?.focus(); });
  $effect(() => {
    const el = document.querySelector('.sp-results .selected');
    el?.scrollIntoView({ block: 'nearest' });
  });

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

<Dialog width={460} zIndex="var(--z-spawned)" onClose={onCancel} titleId="snippet-picker-title">
  {#snippet eyebrow()}Insert{/snippet}
  {#snippet title()}Insert Template{/snippet}
  {#snippet body()}
    <input
      bind:this={inputEl}
      bind:value={query}
      onkeydown={handleKeydown}
      type="text"
      class="input"
      placeholder="Filter templates…"
      autocomplete="off"
    />

    {#if templates.length === 0}
      <div class="empty">No templates in this project yet.</div>
    {:else if results.length === 0}
      <div class="empty">No matches.</div>
    {:else}
      <div class="sp-results" role="listbox">
        {#each results as t, i (t.filename)}
          {@const selected = i === selectedIndex}
          <button
            type="button"
            class="sp-row"
            class:selected
            role="option"
            aria-selected={selected}
            onmousemove={() => { selectedIndex = i; }}
            onclick={() => onPick(t)}
          >
            <Icon name="notes" size={13} color={selected ? 'var(--accent)' : 'var(--text-faint)'} />
            <span class="sp-name">{t.name}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/snippet}
  {#snippet footerLeft()}<span class="kbd-hint">esc · cancel · ↑↓ · ↵ insert</span>{/snippet}
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
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent);
    box-sizing: border-box;
    margin-bottom: 10px;
  }

  .empty {
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
    padding: 16px 0;
  }

  .sp-results {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 280px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px;
    background: var(--bg-inset);
  }
  .sp-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 9px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .sp-row.selected {
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    color: var(--accent);
  }
  .sp-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kbd-hint {
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
</style>
