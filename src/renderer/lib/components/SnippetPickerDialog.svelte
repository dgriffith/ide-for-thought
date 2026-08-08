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
   */
  import type { TemplateInfo } from '../ipc/client';
  import Icon from './Icon.svelte';

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
      <div class="eyebrow">Insert</div>
      <h2 class="title">Insert Template</h2>
    </header>

    <div class="body">
      <input
        bind:this={inputEl}
        bind:value={query}
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
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ↑↓ · ↵ insert</span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-spawned);
    background: rgba(20, 14, 6, 0.5);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }

  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    width: 460px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    color: var(--text);
    overflow: hidden;
  }

  .card-header {
    padding: 20px 24px 0;
  }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 500;
    letter-spacing: -0.005em;
    line-height: 1.3;
    color: var(--text);
  }

  .body {
    padding: 14px 24px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
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

  .card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
  }
  .kbd-hint {
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
</style>
