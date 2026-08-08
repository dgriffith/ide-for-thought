<script lang="ts">
  /**
   * Review dialog for Auto-tag suggestions (#940). The LLM proposed these tags
   * but wrote nothing; the user picks which to keep, and Apply files them through
   * the note_rewrite approval payload. Mirrors AutoLinkDialog's chrome — no danger
   * styling, per-item selection, esc to cancel.
   */
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
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="overlay"
  onkeydown={handleKeydown}
  onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
>
  <div class="dialog" role="dialog" aria-modal="true">
    <header class="card-header">
      <div class="eyebrow">Auto-tag · {tags.length} {tags.length === 1 ? 'suggestion' : 'suggestions'}</div>
      <h2 class="title">Review tags</h2>
      <div class="subtitle">for <code>{relativePath}</code></div>
    </header>

    <div class="body">
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

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel</span>
      <span class="footer-actions">
        <button class="btn ghost" onclick={onCancel}>Cancel</button>
        <button class="btn primary" disabled={selectedCount === 0} onclick={apply}>
          Add {selectedCount} tag{selectedCount === 1 ? '' : 's'}
        </button>
      </span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
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
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-sans);
    color: var(--text);
  }
  .card-header { padding: 20px 24px 0; }
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
  }
  .subtitle { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
  .subtitle code { font-family: var(--font-mono); font-size: 11px; }

  .body {
    padding: 14px 24px 18px;
    overflow: auto;
    flex: 1;
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

  .card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
  }
  .kbd-hint { margin-right: auto; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); }
  .footer-actions { display: inline-flex; gap: 8px; }
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
