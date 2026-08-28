<script lang="ts">
  /**
   * Review dialog for Auto-tag suggestions (#940). The LLM proposed these tags
   * but wrote nothing; the user picks which to keep, and Apply files them through
   * the note_rewrite approval payload. Mirrors AutoLinkDialog's chrome — no danger
   * styling, per-item selection, esc to cancel.
   *
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and backdrop-click
   * are Dialog's job; this component has nothing else to handle.
   */
  import Dialog from './ui/Dialog.svelte';

  interface Props {
    tags: string[];
    /** The note the tags will be added to (shown for context). */
    relativePath: string;
    onApply: (accepted: string[]) => void;
    onCancel: () => void;
  }

  let { tags, relativePath, onApply, onCancel }: Props = $props();

  // Each tag selected by default; the user opts tags out. One-time seed.
  // svelte-ignore state_referenced_locally
  let selected = $state<boolean[]>(tags.map(() => true));

  const selectedCount = $derived(selected.filter(Boolean).length);

  function toggleAll(value: boolean) {
    selected = tags.map(() => value);
  }
  function apply() {
    onApply(tags.filter((_, i) => selected[i]));
  }
</script>

<Dialog width={460} onClose={onCancel} titleId="auto-tag-title">
  {#snippet eyebrow()}Auto-tag · {tags.length} {tags.length === 1 ? 'suggestion' : 'suggestions'}{/snippet}
  {#snippet title()}Review tags{/snippet}
  {#snippet subtitle()}for <code>{relativePath}</code>{/snippet}
  {#snippet body()}
    <div class="body-inner">
      <div class="bulk-row">
        <span class="bulk-count">{selectedCount} of {tags.length} selected</span>
        <span class="bulk-spacer"></span>
        <button class="bulk-btn" onclick={() => toggleAll(true)}>Select all</button>
        <button class="bulk-btn" onclick={() => toggleAll(false)}>Select none</button>
      </div>
      <div class="list">
        {#each tags as tag, i (tag)}
          <label class="row" class:selected={selected[i]}>
            <input type="checkbox" bind:checked={selected[i]} />
            <span class="tag">#{tag}</span>
          </label>
        {/each}
      </div>
    </div>
  {/snippet}
  {#snippet footerLeft()}<span class="kbd-hint">esc · cancel</span>{/snippet}
  {#snippet footerRight()}
    <button class="btn ghost" onclick={onCancel}>Cancel</button>
    <button class="btn primary" disabled={selectedCount === 0} onclick={apply}>
      Add {selectedCount} tag{selectedCount === 1 ? '' : 's'}
    </button>
  {/snippet}
</Dialog>

<style>
  /* Not `.subtitle code` — `.subtitle` is ui/Dialog.svelte's own <p>, not
     this component's; Svelte can't scope through a child's markup, so an
     ancestor-qualified selector here is silently dropped as unused. A bare
     tag selector still scopes correctly to the <code> this component's own
     `subtitle` snippet renders. */
  code { font-family: var(--font-mono); font-size: 11px; }

  .body-inner {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .bulk-row { display: flex; align-items: center; gap: 12px; }
  .bulk-count { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); }
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
  .bulk-btn:hover { color: var(--text); border-color: var(--border-strong); }

  .list { display: flex; flex-wrap: wrap; gap: 8px; }
  .row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    cursor: pointer;
  }
  .row:hover { border-color: var(--border-strong); }
  .row.selected {
    border-color: color-mix(in oklch, var(--accent) 50%, transparent);
    background: color-mix(in oklch, var(--accent) 8%, var(--bg));
  }
  .row input[type='checkbox'] { flex-shrink: 0; accent-color: var(--accent); }
  .tag { font-family: var(--font-mono); font-size: 12px; color: var(--text); }

  .kbd-hint { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); }
  .btn {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
  }
  .btn.ghost { background: transparent; color: var(--text-muted); }
  .btn.ghost:hover { color: var(--text); border-color: var(--border-strong); }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .btn.primary:hover:not(:disabled) { opacity: 0.92; }
  .btn:disabled { opacity: 0.4; cursor: default; }
</style>
