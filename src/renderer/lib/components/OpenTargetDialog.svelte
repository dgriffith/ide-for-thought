<script lang="ts">
  /**
   * Three-button dialog for "open thoughtbase — here or new window?".
   *
   * Different from ConfirmDialog because the choice isn't binary:
   *   - This Window  → clear tabs + open in the current window
   *   - New Window   → spawn a fresh window for the project
   *   - Cancel       → do nothing
   *
   * "This Window" is styled as the default (primary) — pressing Enter
   * takes it, matching the less-disruptive choice for someone who just
   * wanted to switch projects.
   */
  interface Props {
    message: string;
    onThisWindow: () => void;
    onNewWindow: () => void;
    onCancel: () => void;
  }

  let { message, onThisWindow, onNewWindow, onCancel }: Props = $props();
  let thisBtn = $state<HTMLButtonElement>();

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') onThisWindow();
    else if (e.key === 'Escape') onCancel();
  }

  $effect(() => { thisBtn?.focus(); });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog">
    <p class="message">{message}</p>
    <div class="actions">
      <button class="btn secondary" onclick={onCancel}>Cancel</button>
      <button class="btn secondary" onclick={onNewWindow}>New Window</button>
      <button class="btn primary" bind:this={thisBtn} onclick={onThisWindow}>This Window</button>
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
    min-width: 320px;
    max-width: 440px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .message { color: var(--text); font-size: 13px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .btn {
    padding: 5px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .secondary { background: var(--bg-button); color: var(--text); }
  .secondary:hover { background: var(--bg-button-hover); }
  .primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .primary:hover { opacity: 0.9; }
</style>
