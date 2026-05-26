<script lang="ts">
  /**
   * Save Query dialog (#313). Per IMPLEMENTATION.md §10.5 the radio
   * fieldset becomes two side-by-side choice cards explaining "In this
   * thoughtbase" vs "Globally". When no project is open, scope is
   * forced to global and the picker is hidden.
   */
  import Icon from './Icon.svelte';

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

  let name = $state(initialName);
  let scope = $state<'project' | 'global'>(
    !projectOpen ? 'global' : (initialScope ?? 'project'),
  );
  let inputEl = $state<HTMLInputElement>();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && name.trim()) {
      onConfirm({ name: name.trim(), scope });
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }

  $effect(() => {
    inputEl?.focus();
    inputEl?.select();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true">
    <header class="card-header">
      <div class="eyebrow">Save query</div>
      <h2 class="title">Where should this query live?</h2>
    </header>

    <div class="body">
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

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ↵ save</span>
      <span class="footer-actions">
        <button class="btn ghost" onclick={onCancel}>Cancel</button>
        <button class="btn primary" disabled={!name.trim()} onclick={() => onConfirm({ name: name.trim(), scope })}>
          Save
          <span class="btn-kbd">↵</span>
        </button>
      </span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(20, 14, 6, 0.5);
    backdrop-filter: blur(2px);
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
    width: 520px;
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

  .body { padding: 14px 24px 18px; display: flex; flex-direction: column; gap: 14px; }
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

  .card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
  }
  .kbd-hint {
    margin-right: auto;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .footer-actions { display: inline-flex; gap: 8px; }
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
