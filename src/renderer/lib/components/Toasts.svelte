<script lang="ts">
  // Corner container for transient toasts (#1541). Renders the toast store's
  // queue bottom-right; each is dismissable and non-blocking. Clicking the body
  // runs its action (if any) and dismisses; the × dismisses without acting.
  import { getToastStore } from '../stores/toasts.svelte';

  const toasts = getToastStore();
</script>

{#if toasts.items.length > 0}
  <div class="toast-stack" role="status" aria-live="polite">
    {#each toasts.items as t (t.id)}
      <div class="toast" class:clickable={!!t.onClick}>
        <button
          class="toast-body"
          onclick={() => { t.onClick?.(); toasts.dismiss(t.id); }}
        >{t.message}</button>
        <button class="toast-close" title="Dismiss" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>×</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-stack {
    position: fixed;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: var(--z-toast);
    max-width: 320px;
  }
  .toast {
    display: flex;
    align-items: stretch;
    background: var(--bg-button);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }
  .toast-body {
    flex: 1;
    text-align: left;
    padding: 10px 12px;
    background: transparent;
    border: none;
    color: inherit;
    font-size: 13px;
    cursor: default;
  }
  .toast.clickable .toast-body {
    cursor: pointer;
  }
  .toast.clickable:hover {
    border-color: var(--accent);
  }
  .toast-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    padding: 0 10px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  .toast-close:hover {
    color: var(--text);
  }
</style>
