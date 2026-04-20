<script lang="ts">
  import type { AutoLinkSuggestion } from '../../../shared/refactor/auto-link';

  interface Props {
    suggestions: AutoLinkSuggestion[];
    /** Active note body — used to render context snippets around each anchor. */
    activeNoteBody: string;
    onApply: (accepted: AutoLinkSuggestion[]) => void;
    onCancel: () => void;
  }

  let { suggestions, activeNoteBody, onApply, onCancel }: Props = $props();

  // Each suggestion is selected by default. Track selection by index.
  let selected = $state<boolean[]>(suggestions.map(() => true));

  const selectedCount = $derived(selected.filter(Boolean).length);

  function toggleAll(value: boolean) {
    selected = suggestions.map(() => value);
  }

  function apply() {
    const accepted = suggestions.filter((_, i) => selected[i]);
    onApply(accepted);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
  }

  function contextSnippet(anchor: string): string {
    const idx = activeNoteBody.indexOf(anchor);
    if (idx < 0) return '';
    const radius = 50;
    const start = Math.max(0, idx - radius);
    const end = Math.min(activeNoteBody.length, idx + anchor.length + radius);
    const prefix = start > 0 ? '\u2026' : '';
    const suffix = end < activeNoteBody.length ? '\u2026' : '';
    return (
      prefix +
      activeNoteBody.slice(start, idx) +
      '\u00BB' + anchor + '\u00AB' +
      activeNoteBody.slice(idx + anchor.length, end) +
      suffix
    ).replace(/\s+/g, ' ');
  }

  function targetLabel(target: string): string {
    return target.replace(/\.md$/i, '');
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="overlay"
  onkeydown={handleKeydown}
  onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
>
  <div class="dialog">
    <header>
      <h2>Auto-link suggestions</h2>
      <span class="count">{selectedCount} of {suggestions.length} selected</span>
    </header>

    {#if suggestions.length === 0}
      <div class="empty">
        The LLM didn\u2019t find any link candidates in this note. If the note is short or
        doesn\u2019t mention concepts covered by other notes, that\u2019s the expected outcome.
      </div>
    {:else}
      <div class="bulk">
        <button class="link-btn" onclick={() => toggleAll(true)}>Select all</button>
        <button class="link-btn" onclick={() => toggleAll(false)}>Select none</button>
      </div>
      <div class="list">
        {#each suggestions as s, i (i)}
          <label class="row">
            <input type="checkbox" bind:checked={selected[i]} />
            <div class="details">
              <div class="headline">
                <span class="anchor">{s.anchorText}</span>
                <span class="arrow">&rarr;</span>
                <code class="target">[[{targetLabel(s.target)}]]</code>
              </div>
              {#if s.rationale}
                <div class="rationale">{s.rationale}</div>
              {/if}
              <div class="context">{contextSnippet(s.anchorText)}</div>
            </div>
          </label>
        {/each}
      </div>
    {/if}

    <div class="actions">
      <button class="btn" onclick={onCancel}>Cancel</button>
      <button
        class="btn primary"
        disabled={selectedCount === 0}
        onclick={apply}
      >Apply {selectedCount}</button>
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
    align-items: center;
    justify-content: center;
  }

  .dialog {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    width: 640px;
    max-width: 92vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 14px;
    color: var(--text);
    font-weight: 600;
  }

  .count {
    font-size: 11px;
    color: var(--text-muted);
  }

  .empty {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
    padding: 16px 0;
  }

  .bulk {
    display: flex;
    gap: 8px;
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    padding: 0;
    font-size: 11px;
    cursor: pointer;
    text-decoration: underline;
  }

  .link-btn:hover {
    opacity: 0.8;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-right: 4px;
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    cursor: pointer;
  }

  .row:hover {
    border-color: var(--accent);
  }

  .row input[type='checkbox'] {
    margin-top: 2px;
    flex-shrink: 0;
  }

  .details {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .headline {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    flex-wrap: wrap;
  }

  .anchor {
    color: var(--text);
    font-weight: 600;
  }

  .arrow {
    color: var(--text-muted);
  }

  .target {
    color: var(--accent);
    font-size: 11px;
  }

  .rationale {
    font-size: 12px;
    color: var(--text);
    line-height: 1.4;
  }

  .context {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.5;
    font-family: var(--font-mono, ui-monospace, monospace);
    padding: 4px 8px;
    background: var(--bg-button);
    border-radius: 4px;
    word-break: break-word;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  }

  .btn {
    padding: 5px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: var(--bg-button-hover);
  }

  .btn.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }

  .btn.primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
