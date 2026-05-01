<script lang="ts">
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
    onConfirm: (dontAskAgain: boolean) => void;
    onCancel: () => void;
  }

  let { message, confirmLabel = 'OK', hideDontAskAgain = false, onConfirm, onCancel }: Props = $props();
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
  <div class="dialog">
    <p class="message">{message}</p>
    {#if !hideDontAskAgain}
      <label class="dont-ask">
        <input type="checkbox" bind:checked={dontAskAgain} />
        Don't ask again
      </label>
    {/if}
    <div class="actions">
      <button class="btn secondary" onclick={onCancel}>Cancel</button>
      <button class="btn primary" bind:this={confirmBtn} onclick={() => onConfirm(dontAskAgain)}>{confirmLabel}</button>
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
    min-width: 300px;
    max-width: 400px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .message {
    color: var(--text);
    font-size: 13px;
  }

  .dont-ask {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
  }

  .dont-ask input {
    cursor: pointer;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn {
    padding: 5px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .secondary {
    background: var(--bg-button);
    color: var(--text);
  }

  .secondary:hover {
    background: var(--bg-button-hover);
  }

  .primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }

  .primary:hover {
    opacity: 0.9;
  }
</style>
