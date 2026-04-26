<script lang="ts">
  /**
   * Save Query dialog (#313). Asks for the query name + scope. When no
   * thoughtbase is open, scope is forced to global and the picker
   * collapses to a hint.
   */

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
  <div class="dialog">
    <label class="message" for="save-query-name">Save query as</label>
    <input
      id="save-query-name"
      bind:this={inputEl}
      bind:value={name}
      type="text"
      class="input"
      placeholder="Query name"
    />

    {#if projectOpen}
      <fieldset class="scope">
        <legend class="scope-label">Scope</legend>
        <label class="radio">
          <input type="radio" name="scope" value="project" bind:group={scope} />
          <span>Thoughtbase</span>
          <span class="hint">— this project only</span>
        </label>
        <label class="radio">
          <input type="radio" name="scope" value="global" bind:group={scope} />
          <span>Global</span>
          <span class="hint">— available in every thoughtbase</span>
        </label>
      </fieldset>
    {:else}
      <p class="solo-hint">Saved as a Global query — no thoughtbase is open.</p>
    {/if}

    <div class="actions">
      <button class="btn cancel" onclick={onCancel}>Cancel</button>
      <button class="btn confirm" disabled={!name.trim()} onclick={() => onConfirm({ name: name.trim(), scope })}>Save</button>
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
    min-width: 360px;
    max-width: 440px;
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
    box-sizing: border-box;
  }

  .input:focus { border-color: var(--accent); }

  .scope {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .scope-label {
    color: var(--text-muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .radio {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }

  .hint { color: var(--text-muted); font-size: 12px; }

  .solo-hint {
    margin: 0;
    padding: 6px 8px;
    background: var(--bg-button);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 12px;
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

  .cancel { background: var(--bg-button); color: var(--text); }
  .cancel:hover { background: var(--bg-button-hover); }

  .confirm {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .confirm:hover { opacity: 0.9; }
  .confirm:disabled { opacity: 0.4; cursor: default; }
</style>
