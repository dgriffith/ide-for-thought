<script lang="ts">
  /**
   * Dialog for "open thoughtbase — here or new window?".
   *
   * Per IMPLEMENTATION.md §10.5: three buttons → two choice cards
   * with kbd hints (↵ for the primary "this window", ⌘ ↵ for new
   * window). Cancel becomes a footer ghost button.
   *
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and
   * backdrop-click are Dialog's job. Plain Enter and ⌘Enter still need a
   * dialog-wide handler: both must fire regardless of which choice card
   * (or the Cancel button) currently has focus, which native
   * Enter-clicks-the-focused-button behavior alone can't provide for the
   * modified (⌘Enter) case.
   */
  import Icon from './Icon.svelte';
  import Dialog from './ui/Dialog.svelte';

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
    }
  }

  $effect(() => { thisBtn?.focus(); });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onkeydown={handleKeydown}>
  <Dialog width={480} zIndex="var(--z-spawned)" onClose={onCancel} titleId="open-target-title">
    {#snippet eyebrow()}Open thoughtbase{/snippet}
    {#snippet title()}{message}{/snippet}
    {#snippet body()}
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
    {/snippet}
    {#snippet footerLeft()}<span class="kbd-hint">esc · cancel</span>{/snippet}
    {#snippet footerRight()}<button class="btn ghost" onclick={onCancel}>Cancel</button>{/snippet}
  </Dialog>
</div>

<style>
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

  .kbd-hint {
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
