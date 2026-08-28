<script lang="ts">
  /**
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and backdrop-click
   * are Dialog's job; this component has nothing else to handle.
   */
  import type { AutoLinkSuggestion } from '../../../shared/refactor/auto-link';
  import Dialog from './ui/Dialog.svelte';

  interface Props {
    suggestions: AutoLinkSuggestion[];
    /** Active note body — used to render context snippets around each anchor. */
    activeNoteBody: string;
    onApply: (accepted: AutoLinkSuggestion[]) => void;
    onCancel: () => void;
  }

  let { suggestions, activeNoteBody, onApply, onCancel }: Props = $props();

  // Each suggestion is selected by default. Track selection by index.
  // Intentional one-time seed from `suggestions`; dialog is short-lived and keyed.
  // svelte-ignore state_referenced_locally
  let selected = $state<boolean[]>(suggestions.map(() => true));

  const selectedCount = $derived(selected.filter(Boolean).length);

  function toggleAll(value: boolean) {
    selected = suggestions.map(() => value);
  }

  function apply() {
    const accepted = suggestions.filter((_, i) => selected[i]);
    onApply(accepted);
  }

  function contextSnippet(anchor: string): string {
    const idx = activeNoteBody.indexOf(anchor);
    if (idx < 0) return '';
    const radius = 50;
    const start = Math.max(0, idx - radius);
    const end = Math.min(activeNoteBody.length, idx + anchor.length + radius);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < activeNoteBody.length ? '…' : '';
    return (
      prefix +
      activeNoteBody.slice(start, idx) +
      '»' + anchor + '«' +
      activeNoteBody.slice(idx + anchor.length, end) +
      suffix
    ).replace(/\s+/g, ' ');
  }

  function targetLabel(target: string): string {
    return target.replace(/\.md$/i, '');
  }
</script>

<Dialog width={640} onClose={onCancel} titleId="auto-link-title">
  {#snippet eyebrow()}Auto-link · {suggestions.length} {suggestions.length === 1 ? 'candidate' : 'candidates'}{/snippet}
  {#snippet title()}Review link suggestions{/snippet}
  {#snippet body()}
    {#if suggestions.length === 0}
      <div class="empty">
        The LLM didn't find any link candidates in this note. If the note is short or
        doesn't mention concepts covered by other notes, that's the expected outcome.
      </div>
    {:else}
      <div class="body-inner">
        <div class="bulk-row">
          <span class="bulk-count">{selectedCount} of {suggestions.length} selected</span>
          <span class="bulk-spacer"></span>
          <button class="bulk-btn" onclick={() => toggleAll(true)}>Select all</button>
          <button class="bulk-btn" onclick={() => toggleAll(false)}>Select none</button>
        </div>
        <div class="list">
          {#each suggestions as s, i (i)}
            <label class="row" class:selected={selected[i]}>
              <input type="checkbox" bind:checked={selected[i]} />
              <div class="details">
                <div class="headline">
                  <span class="anchor">{s.anchorText}</span>
                  <span class="arrow">→</span>
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
      </div>
    {/if}
  {/snippet}
  {#snippet footerLeft()}<span class="kbd-hint">esc · cancel</span>{/snippet}
  {#snippet footerRight()}
    <button class="btn ghost" onclick={onCancel}>Cancel</button>
    <button
      class="btn primary"
      disabled={selectedCount === 0}
      onclick={apply}
    >Apply {selectedCount}</button>
  {/snippet}
</Dialog>

<style>
  .body-inner {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .empty {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .bulk-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .bulk-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
  }
  .bulk-spacer { flex: 1; }
  .bulk-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 3px 9px;
    border-radius: 5px;
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .bulk-btn:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }

  .list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    cursor: pointer;
  }
  .row:hover {
    border-color: var(--border-strong);
  }
  .row.selected {
    border-color: color-mix(in oklch, var(--accent) 50%, transparent);
    background: color-mix(in oklch, var(--accent) 8%, var(--bg));
  }

  .row input[type='checkbox'] {
    margin-top: 3px;
    flex-shrink: 0;
    accent-color: var(--accent);
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
    gap: 8px;
    font-size: 12.5px;
    flex-wrap: wrap;
  }

  .anchor {
    color: var(--text);
    font-weight: 500;
  }

  .arrow {
    color: var(--text-faint);
    font-family: var(--font-mono);
  }

  .target {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 11.5px;
    background: color-mix(in oklch, var(--accent) 12%, transparent);
    padding: 1px 6px;
    border-radius: 4px;
  }

  .rationale {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .context {
    font-size: 11px;
    color: var(--text-faint);
    line-height: 1.55;
    font-family: var(--font-mono);
    padding: 5px 9px;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 4px;
    word-break: break-word;
  }

  .kbd-hint {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }

  .btn {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
  }
  .btn.ghost {
    background: transparent;
    color: var(--text-muted);
  }
  .btn.ghost:hover {
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
</style>
