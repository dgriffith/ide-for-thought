<script lang="ts">
  /**
   * Confirm dialog refreshed per IMPLEMENTATION.md §10.1. Signature
   * (`showConfirm(message, key, label, opts)`) is unchanged — only
   * the rendering. Keeps the "Don't ask again" checkbox per CLAUDE.md
   * unless `hideDontAskAgain` is set, and the primary CTA stays on
   * the accent color even for destructive verbs (no danger styling).
   */
  interface Props {
    message: string;
    confirmLabel?: string;
    /**
     * When true, hide the "Don't ask again" checkbox. Used by the
     * Python trust dialog (#373) where consent is project-scoped, not
     * machine-scoped — the localStorage suppression that would normally
     * fire on this checkbox would leak per-thoughtbase trust into a
     * global "trust everywhere" state, which is explicitly out of
     * scope for #373.
     */
    hideDontAskAgain?: boolean;
    /** Relabel the "Don't ask again" checkbox — the compute-consent dialog
     *  (#1412) reuses it as "Trust all compute in this thoughtbase". */
    dontAskLabel?: string;
    /** When set, render the code the action will run in a scrollable block —
     *  the "eyes-on-code" compute-consent prompt (#1412). */
    code?: string;
    onConfirm: (dontAskAgain: boolean) => void;
    onCancel: () => void;
  }

  let { message, confirmLabel = 'OK', hideDontAskAgain = false, dontAskLabel = "Don't ask again", code, onConfirm, onCancel }: Props = $props();
  let dontAskAgain = $state(false);
  let confirmBtn = $state<HTMLButtonElement>();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      onConfirm(dontAskAgain);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }

  $effect(() => {
    confirmBtn?.focus();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
    <header class="card-header">
      <div class="eyebrow">Confirm action</div>
      <h2 class="title" id="confirm-dialog-title">{message}</h2>
    </header>

    {#if code !== undefined || !hideDontAskAgain}
      <div class="body">
        {#if code !== undefined}
          <pre class="code-preview"><code>{code}</code></pre>
        {/if}
        {#if !hideDontAskAgain}
          <label class="dont-ask">
            <input type="checkbox" bind:checked={dontAskAgain} />
            {dontAskLabel}
          </label>
        {/if}
      </div>
    {/if}

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ↵ confirm</span>
      <span class="footer-actions">
        <button class="btn secondary" onclick={onCancel}>Cancel</button>
        <button class="btn primary" bind:this={confirmBtn} onclick={() => onConfirm(dontAskAgain)}>
          {confirmLabel}
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
    z-index: 2000;
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
    width: 440px;
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
    font-size: 13px;
  }
  .code-preview {
    margin: 0 0 12px;
    padding: 12px 14px;
    max-height: 320px;
    overflow: auto;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text);
    white-space: pre;
    tab-size: 4;
  }
  .dont-ask {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .dont-ask input {
    accent-color: var(--accent);
    cursor: pointer;
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
  /* "primary" not "danger" per CLAUDE.md — destructive verbs stay
     on the accent color, never red. */
  .primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .primary:hover {
    opacity: 0.92;
  }
  .btn-kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.7;
  }
</style>
