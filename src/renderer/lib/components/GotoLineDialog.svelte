<script lang="ts">
  interface Props {
    currentLine: number;
    currentColumn: number;
    onGoto: (line: number, column: number) => void;
    onCancel: () => void;
  }

  let { currentLine, currentColumn, onGoto, onCancel }: Props = $props();
  let value = $state('');
  let inputEl = $state<HTMLInputElement>();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      e.stopPropagation();
      const parts = value.split(':');
      const line = parseInt(parts[0], 10);
      const col = parts[1] ? parseInt(parts[1], 10) : 1;
      if (!isNaN(line)) onGoto(line, isNaN(col) ? 1 : col);
    } else if (e.key === 'Escape') {
      e.preventDefault();
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
    <input
      bind:this={inputEl}
      bind:value
      type="text"
      class="input"
      placeholder="{currentLine}:{currentColumn}"
    />
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    justify-content: center;
    padding-top: 20vh;
  }

  .dialog {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    width: 280px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    height: fit-content;
  }

  .input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    font-family: inherit;
    outline: none;
  }

  .input:focus {
    border-color: var(--accent);
  }

  .input::placeholder {
    color: var(--text-muted);
  }
</style>
