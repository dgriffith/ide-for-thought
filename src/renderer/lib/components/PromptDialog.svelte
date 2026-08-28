<script lang="ts">
  /**
   * Prompt dialog refreshed per IMPLEMENTATION.md §10.1. Signature
   * (`showPrompt(message, opts)`) is unchanged — only the rendering.
   *
   * Renders via ui/Dialog.svelte (#1888) rather than hand-rolling the
   * overlay/card scaffolding — Escape-to-cancel and backdrop-click are
   * Dialog's job now; this component only owns the input and the
   * Enter-to-confirm behavior specific to it.
   */
  import Dialog from './ui/Dialog.svelte';

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
  }

  let { message, onConfirm, onCancel, suggestions = [], initial = '' }: Props = $props();
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
    }
  }

  $effect(() => {
    inputEl?.focus();
    if (!initial || !inputEl) return;
    // Pre-select the seeded value so the user can type to replace it but
    // Tab/Enter to accept as-is.
    inputEl.select();
  });
</script>

<Dialog width={460} zIndex="var(--z-spawned)" onClose={onCancel} titleId="prompt-dialog-title">
  {#snippet eyebrow()}Input{/snippet}
  {#snippet title()}{message}{/snippet}
  {#snippet body()}
    <input
      bind:this={inputEl}
      bind:value
      onkeydown={handleKeydown}
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
  {/snippet}
  {#snippet footerLeft()}<span class="kbd-hint">esc · cancel · ↵ confirm</span>{/snippet}
  {#snippet footerRight()}
    <button class="btn secondary" onclick={onCancel}>Cancel</button>
    <button class="btn primary" disabled={!value.trim()} onclick={() => onConfirm(value.trim())}>
      OK
      <span class="btn-kbd">↵</span>
    </button>
  {/snippet}
</Dialog>

<style>
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
