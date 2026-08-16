<script lang="ts">
  /**
   * Dialog for "open thoughtbase — here or new window?".
   *
   * Per IMPLEMENTATION.md §10.5: three buttons → two choice cards
   * with kbd hints (↵ for the primary "this window", ⌘ ↵ for new
   * window). Cancel becomes a footer ghost button.
   */
  import Icon from './Icon.svelte';

  interface Props {
    message: string;
    onThisWindow: () => void;
    onNewWindow: () => void;
    onCancel: () => void;
  }

  let { message, onThisWindow, onNewWindow, onCancel }: Props = $props();
  let thisBtn = $state<HTMLButtonElement>();

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      if (e.metaKey || e.ctrlKey) onNewWindow();
      else onThisWindow();
    } else if (e.key === 'Escape') onCancel();
  }

  $effect(() => { thisBtn?.focus(); });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true">
    <header class="card-header">
      <div class="eyebrow">Open thoughtbase</div>
      <h2 class="title">{message}</h2>
    </header>

    <div class="body">
      <div class="choices">
        <button class="choice" bind:this={thisBtn} onclick={onThisWindow}>
          <Icon name="forward" size={16} color="var(--accent)" />
          <span class="choice-body">
            <span class="choice-title">In this window</span>
            <span class="choice-sub">Closes the current view and opens the project here. The current view is preserved in tab history.</span>
          </span>
          <span class="choice-kbd">↵</span>
        </button>
        <button class="choice" onclick={onNewWindow}>
          <Icon name="plus" size={16} color="var(--text-muted)" />
          <span class="choice-body">
            <span class="choice-title">In a new window</span>
            <span class="choice-sub">Keeps the current thoughtbase up and opens this one side by side.</span>
          </span>
          <span class="choice-kbd">⌘ ↵</span>
        </button>
      </div>
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel</span>
      <button class="btn ghost" onclick={onCancel}>Cancel</button>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-spawned);
    background: var(--scrim-bg);
    backdrop-filter: var(--scrim-blur);
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
    width: 480px;
    max-width: 100%;
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
  .body { padding: 14px 24px 18px; }

  /* Two choice cards stacked (§10.5). Default-focused card gets the
     accent ring; secondary card is ghost. */
  .choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .choice:focus {
    outline: none;
    border-color: var(--accent);
    background: color-mix(in oklch, var(--accent) 8%, var(--bg));
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent);
  }
  .choice:hover {
    border-color: var(--border-strong);
  }
  .choice-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .choice-title {
    font-size: 13px;
    font-weight: 500;
  }
  .choice-sub {
    font-size: 11.5px;
    color: var(--text-muted);
    line-height: 1.4;
  }
  .choice-kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 2px 6px;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-faint);
    flex-shrink: 0;
  }

  .card-footer {
    display: flex;
    align-items: center;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
  }
  .kbd-hint {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .btn {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
  }
  .btn.ghost:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
</style>
