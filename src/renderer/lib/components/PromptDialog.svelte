<script lang="ts">
  interface Props {
    message: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
  }

  let { message, onConfirm, onCancel }: Props = $props();
  let value = $state('');
  let inputEl = $state<HTMLInputElement>();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && value.trim()) {
      onConfirm(value.trim());
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }

  $effect(() => {
    inputEl?.focus();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog">
    <label class="message">{message}</label>
    <input
      bind:this={inputEl}
      bind:value
      type="text"
      class="input"
    />
    <div class="actions">
      <button class="btn cancel" onclick={onCancel}>Cancel</button>
      <button class="btn confirm" disabled={!value.trim()} onclick={() => onConfirm(value.trim())}>OK</button>
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

  .input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    outline: none;
  }

  .input:focus {
    border-color: var(--accent);
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

  .cancel {
    background: var(--bg-button);
    color: var(--text);
  }

  .cancel:hover {
    background: var(--bg-button-hover);
  }

  .confirm {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }

  .confirm:hover {
    opacity: 0.9;
  }

  .confirm:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
