<script lang="ts">
  /**
   * Prompt dialog refreshed per IMPLEMENTATION.md §10.1. Signature
   * (`showPrompt(message, opts)`) is unchanged — only the rendering.
   */
  interface Props {
    message: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
    /** Optional autocomplete pool. Rendered via <datalist> so the
     *  browser handles filtering + keyboard nav for free. Used by the
     *  bulk Add/Remove Tag flow; harmless when omitted. */
    suggestions?: string[];
    /** Optional pre-seeded value (e.g. Rename) — the input opens
     *  populated with this string, fully selected. */
    initial?: string;
    /** When true, pre-select only the filename stem (text before the last
     *  dot) rather than the whole value, so typing replaces the name but
     *  visibly keeps the extension. Used by Rename. Falls back to a full
     *  select when `initial` has no extension. */
    selectStem?: boolean;
  }

  let { message, onConfirm, onCancel, suggestions = [], initial = '', selectStem = false }: Props = $props();
  // Intentional one-time seed from `initial`; dialog is short-lived and keyed.
  // svelte-ignore state_referenced_locally
  let value = $state(initial);
  let inputEl = $state<HTMLInputElement>();
  // Stable id so multiple PromptDialogs (rare, but possible during
  // overlapping flows) don't collide on the datalist anchor.
  const listId = `prompt-dialog-suggestions-${Math.random().toString(36).slice(2, 9)}`;

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && value.trim()) {
      onConfirm(value.trim());
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }

  $effect(() => {
    inputEl?.focus();
    if (!initial || !inputEl) return;
    // Pre-select the seeded value so the user can type to replace it but
    // Tab/Enter to accept as-is. For Rename, select only the stem (before
    // the last dot) so the extension stays visible and untouched.
    const dot = initial.lastIndexOf('.');
    if (selectStem && dot > 0) inputEl.setSelectionRange(0, dot);
    else inputEl.select();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-dialog-title">
    <header class="card-header">
      <div class="eyebrow">Input</div>
      <h2 class="title" id="prompt-dialog-title">{message}</h2>
    </header>

    <div class="body">
      <input
        bind:this={inputEl}
        bind:value
        type="text"
        class="input"
        aria-labelledby="prompt-dialog-title"
        list={suggestions.length > 0 ? listId : undefined}
        autocomplete="off"
      />
      {#if suggestions.length > 0}
        <datalist id={listId}>
          {#each suggestions as s}
            <option value={s}></option>
          {/each}
        </datalist>
      {/if}
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ↵ confirm</span>
      <span class="footer-actions">
        <button class="btn secondary" onclick={onCancel}>Cancel</button>
        <button class="btn primary" disabled={!value.trim()} onclick={() => onConfirm(value.trim())}>
          OK
          <span class="btn-kbd">↵</span>
        </button>
      </span>
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
    margin-right: auto;
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .footer-actions {
    display: inline-flex;
    gap: 8px;
  }

  .btn {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .secondary {
    background: transparent;
    color: var(--text-muted);
  }
  .secondary:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .primary:hover:not(:disabled) {
    opacity: 0.92;
  }
  .primary:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .btn-kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.7;
  }
</style>
