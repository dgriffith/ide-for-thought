<script lang="ts">
  /**
   * Confirm dialog refreshed per IMPLEMENTATION.md §10.1. Signature
   * (`showConfirm(message, key, label, opts)`) is unchanged — only
   * the rendering. Keeps the "Don't ask again" checkbox per CLAUDE.md
   * unless `hideDontAskAgain` is set, and the primary CTA stays on
   * the accent color even for destructive verbs (no danger styling).
   *
   * Renders via ui/Dialog.svelte (#1888) rather than hand-rolling the
   * overlay/card scaffolding — Escape-to-cancel and backdrop-click are
   * Dialog's job now; this component only owns Enter-to-confirm and its
   * own body content (code preview / checkbox).
   */
  import Dialog from './ui/Dialog.svelte';

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
    }
  }

  $effect(() => {
    confirmBtn?.focus();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onkeydown={handleKeydown}>
  <Dialog width={440} zIndex="var(--z-spawned)" onClose={onCancel} titleId="confirm-dialog-title">
    {#snippet eyebrow()}Confirm action{/snippet}
    {#snippet title()}{message}{/snippet}
    {#snippet body()}
      {#if code !== undefined || !hideDontAskAgain}
        {#if code !== undefined}
          <pre class="code-preview"><code>{code}</code></pre>
        {/if}
        {#if !hideDontAskAgain}
          <label class="dont-ask">
            <input type="checkbox" bind:checked={dontAskAgain} />
            {dontAskLabel}
          </label>
        {/if}
      {/if}
    {/snippet}
    {#snippet footerLeft()}<span class="kbd-hint">esc · cancel · ↵ confirm</span>{/snippet}
    {#snippet footerRight()}
      <button class="btn secondary" onclick={onCancel}>Cancel</button>
      <button class="btn primary" bind:this={confirmBtn} onclick={() => onConfirm(dontAskAgain)}>
        {confirmLabel}
        <span class="btn-kbd">↵</span>
      </button>
    {/snippet}
  </Dialog>
</div>

<style>
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

  .kbd-hint {
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
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
