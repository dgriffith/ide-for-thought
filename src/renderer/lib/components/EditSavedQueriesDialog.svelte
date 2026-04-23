<script lang="ts">
  import { onMount } from 'svelte';
  import type { SavedQuery } from '../../../shared/types';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let queries = $state<SavedQuery[]>([]);
  let renamingPath = $state<string | null>(null);
  let renameValue = $state('');
  let renameInput = $state<HTMLInputElement>();

  async function load() {
    queries = await window.api.queries.list();
  }

  onMount(() => { load(); });

  const projectQueries = $derived(queries.filter((q) => q.scope === 'project'));
  const globalQueries = $derived(queries.filter((q) => q.scope === 'global'));
  // Same rule as the title-bar menu: show scope labels only when both
  // scopes are populated, else the label is dead weight over the one
  // group that exists.
  const showScopeLabels = $derived(projectQueries.length > 0 && globalQueries.length > 0);

  function startRename(q: SavedQuery) {
    renamingPath = q.filePath;
    renameValue = q.name;
    queueMicrotask(() => { renameInput?.focus(); renameInput?.select(); });
  }

  async function commitRename(q: SavedQuery) {
    const next = renameValue.trim();
    renamingPath = null;
    if (!next || next === q.name) return;
    await window.api.queries.rename(q.filePath, next);
    await load();
  }

  function cancelRename() {
    renamingPath = null;
  }

  async function deleteQ(q: SavedQuery) {
    await window.api.queries.delete(q.filePath);
    await load();
  }

  function overlayKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && renamingPath === null) onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={overlayKey} onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="dialog">
    <h3 class="title">Saved Queries</h3>

    {#if queries.length === 0}
      <p class="empty">No saved queries yet.</p>
    {:else}
      {#if projectQueries.length > 0}
        {#if showScopeLabels}<div class="section-label">Thoughtbase</div>{/if}
        <ul class="list">
          {#each projectQueries as q (q.filePath)}
            <li class="row">
              {#if renamingPath === q.filePath}
                <input
                  bind:this={renameInput}
                  bind:value={renameValue}
                  class="name-input"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(q); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                  }}
                  onblur={() => commitRename(q)}
                />
              {:else}
                <span class="name">{q.name}</span>
                <button class="row-btn" onclick={() => startRename(q)}>Rename</button>
                <button class="row-btn" onclick={() => deleteQ(q)}>Delete</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if globalQueries.length > 0}
        {#if showScopeLabels}<div class="section-label">Global</div>{/if}
        <ul class="list">
          {#each globalQueries as q (q.filePath)}
            <li class="row">
              {#if renamingPath === q.filePath}
                <input
                  bind:this={renameInput}
                  bind:value={renameValue}
                  class="name-input"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(q); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                  }}
                  onblur={() => commitRename(q)}
                />
              {:else}
                <span class="name">{q.name}</span>
                <button class="row-btn" onclick={() => startRename(q)}>Rename</button>
                <button class="row-btn" onclick={() => deleteQ(q)}>Delete</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

    <div class="actions">
      <button class="btn" onclick={onClose}>Close</button>
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
    min-width: 420px;
    max-width: 560px;
    max-height: 70vh;
    overflow-y: auto;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .title {
    margin: 0 0 4px 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .empty {
    color: var(--text-muted);
    font-size: 13px;
    margin: 8px 0;
  }
  .section-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    padding: 6px 0 4px 0;
    border-bottom: 1px solid var(--border);
    margin-top: 8px;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 4px;
  }
  .row:hover { background: var(--bg-button); }
  .name {
    flex: 1;
    color: var(--text);
    font-size: 13px;
  }
  .name-input {
    flex: 1;
    padding: 2px 6px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }
  .row-btn {
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
  }
  .row-btn:hover { background: var(--bg-button-hover); }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }
  .btn {
    padding: 5px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
    font-size: 12px;
    cursor: pointer;
  }
  .btn:hover { opacity: 0.9; }
</style>
