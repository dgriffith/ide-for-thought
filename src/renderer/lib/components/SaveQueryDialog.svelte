<script lang="ts">
  /**
   * Save Query dialog (#313). Per IMPLEMENTATION.md §10.5 the radio
   * fieldset becomes two side-by-side choice cards explaining "In this
   * thoughtbase" vs "Globally". When no project is open, scope is
   * forced to global and the picker is hidden.
   *
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and
   * backdrop-click are Dialog's job. Enter-to-save keeps a dialog-wide
   * handler (wrapping <Dialog>) rather than moving to the name input
   * alone: Enter must still save while focus is on one of the scope
   * cards, which don't natively respond to Enter.
   */
  import Icon from './Icon.svelte';
  import Dialog from './ui/Dialog.svelte';

  interface Props {
    /** True when a project is open; controls whether Thoughtbase is offered. */
    projectOpen: boolean;
    /** Default name (e.g. existing tab title). */
    initialName?: string;
    /** Default scope. Caller usually wants 'project' when projectOpen is true. */
    initialScope?: 'project' | 'global';
    onConfirm: (args: { name: string; scope: 'project' | 'global' }) => void;
    onCancel: () => void;
  }

  let { projectOpen, initialName = '', initialScope, onConfirm, onCancel }: Props = $props();

  // Intentional one-time seed from props; dialog is short-lived and keyed.
  // svelte-ignore state_referenced_locally
  let name = $state(initialName);
  // svelte-ignore state_referenced_locally
  let scope = $state<'project' | 'global'>(
    !projectOpen ? 'global' : (initialScope ?? 'project'),
  );
  let inputEl = $state<HTMLInputElement>();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && name.trim()) {
      onConfirm({ name: name.trim(), scope });
    }
  }

  $effect(() => {
    inputEl?.focus();
    inputEl?.select();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onkeydown={handleKeydown}>
  <Dialog width={520} onClose={onCancel} titleId="save-query-title">
    {#snippet eyebrow()}Save query{/snippet}
    {#snippet title()}Where should this query live?{/snippet}
    {#snippet body()}
      <div class="body-inner">
        <label class="field-label" for="save-query-name">Name</label>
        <input
          id="save-query-name"
          bind:this={inputEl}
          bind:value={name}
          type="text"
          class="input"
          placeholder="e.g. Unreviewed LLM writes"
        />

        {#if projectOpen}
          <div class="scope-label">Scope</div>
          <div class="scope-cards" role="radiogroup" aria-label="Save scope">
            <button
              class="scope-card"
              class:selected={scope === 'project'}
              type="button"
              role="radio"
              aria-checked={scope === 'project'}
              onclick={() => { scope = 'project'; }}
            >
              <Icon name="folder" size={14} color={scope === 'project' ? 'var(--accent)' : 'var(--text-faint)'} />
              <span class="scope-title">In this thoughtbase</span>
              <span class="scope-sub">Saved next to the project's notes — others who open it will see this query.</span>
            </button>
            <button
              class="scope-card"
              class:selected={scope === 'global'}
              type="button"
              role="radio"
              aria-checked={scope === 'global'}
              onclick={() => { scope = 'global'; }}
            >
              <Icon name="settings" size={14} color={scope === 'global' ? 'var(--accent)' : 'var(--text-faint)'} />
              <span class="scope-title">Globally</span>
              <span class="scope-sub">Available in every thoughtbase you open on this machine.</span>
            </button>
          </div>
        {:else}
          <p class="solo-hint">
            <Icon name="settings" size={12} color="var(--text-faint)" />
            Saved as a Global query — no thoughtbase is open.
          </p>
        {/if}
      </div>
    {/snippet}
    {#snippet footerLeft()}<span class="kbd-hint">esc · cancel · ↵ save</span>{/snippet}
    {#snippet footerRight()}
      <button class="btn ghost" onclick={onCancel}>Cancel</button>
      <button class="btn primary" disabled={!name.trim()} onclick={() => onConfirm({ name: name.trim(), scope })}>
        Save
        <span class="btn-kbd">↵</span>
      </button>
    {/snippet}
  </Dialog>
</div>

<style>
  .body-inner { display: flex; flex-direction: column; gap: 14px; }
  .field-label {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--text-muted);
  }
  .input {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg-inset);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: var(--font-sans);
    font-size: 13px;
    outline: none;
  }
  .input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent);
  }

  .scope-label {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 2px;
  }
  /* Two side-by-side choice cards (§10.5) */
  .scope-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .scope-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .scope-card:hover { border-color: var(--border-strong); }
  .scope-card.selected {
    border-color: color-mix(in oklch, var(--accent) 50%, transparent);
    background: color-mix(in oklch, var(--accent) 8%, var(--bg));
  }
  .scope-title {
    font-size: 13px;
    font-weight: 500;
    margin-top: 4px;
  }
  .scope-card.selected .scope-title { color: var(--accent); }
  .scope-sub {
    font-size: 11.5px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .solo-hint {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 12px;
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
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .btn.ghost {
    background: transparent;
    color: var(--text-muted);
  }
  .btn.ghost:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .btn.primary:hover:not(:disabled) { opacity: 0.92; }
  .btn.primary:disabled { opacity: 0.4; cursor: default; }
  .btn-kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.7;
  }
</style>
