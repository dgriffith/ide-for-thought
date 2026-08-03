<script lang="ts">
  /**
   * Manage saved views (#1072) — rename, delete, reorder. Mirrors
   * EditSavedQueriesDialog but leaner: no scope-move, no groups. Views are
   * grouped into Thoughtbase / Global sections; reorder is per-section via
   * up/down, writing an explicit order across that section. All mutations go
   * through the saved-views store (renderer data-flow rule #1086).
   */
  import { onMount } from 'svelte';
  import { savedViewsStore } from '../stores/saved-views.svelte';
  import type { SavedView, ViewScope } from '../../../shared/types';

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  let renamingPath = $state<string | null>(null);
  let renameValue = $state('');
  let renameInput = $state<HTMLInputElement>();

  onMount(() => { void savedViewsStore.refresh(); });

  const sections = $derived<{ scope: ViewScope; label: string; items: SavedView[] }[]>(
    (['project', 'global'] as ViewScope[])
      .map((scope) => ({
        scope,
        label: scope === 'project' ? 'Thoughtbase' : 'Global',
        items: savedViewsStore.views.filter((v) => v.scope === scope),
      }))
      .filter((s) => s.items.length > 0),
  );

  function startRename(v: SavedView): void {
    renamingPath = v.filePath;
    renameValue = v.name;
    requestAnimationFrame(() => renameInput?.focus());
  }
  async function commitRename(): Promise<void> {
    const path = renamingPath;
    const name = renameValue.trim();
    renamingPath = null;
    if (path && name) await savedViewsStore.rename(path, name);
  }

  async function remove(v: SavedView): Promise<void> {
    await savedViewsStore.remove(v.filePath);
  }

  /** Swap a view with its neighbour in the section and persist the new order. */
  async function move(items: SavedView[], index: number, dir: -1 | 1): Promise<void> {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[j]] = [reordered[j]!, reordered[index]!];
    await savedViewsStore.reorder(reordered.map((v, i) => ({ filePath: v.filePath, order: i })));
  }

  function overlayKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
  }
</script>

<div class="overlay" onkeydown={overlayKey} onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Manage saved views">
    <h3 class="title">Saved Views</h3>

    {#if sections.length === 0}
      <p class="empty">No saved views yet. Configure a type view and choose “Save view”.</p>
    {:else}
      {#each sections as section (section.scope)}
        {#if sections.length > 1}<div class="section-label">{section.label}</div>{/if}
        <ul class="list">
          {#each section.items as v, i (v.filePath)}
            <li class="row">
              {#if renamingPath === v.filePath}
                <input
                  class="name-input"
                  bind:this={renameInput}
                  bind:value={renameValue}
                  onblur={commitRename}
                  onkeydown={(e) => { if (e.key === 'Enter') void commitRename(); else if (e.key === 'Escape') renamingPath = null; }}
                />
              {:else}
                <span
                  class="name"
                  role="button"
                  tabindex="0"
                  title="Double-click or press Enter to rename"
                  ondblclick={() => startRename(v)}
                  onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'F2') startRename(v); }}
                >{v.name}</span>
              {/if}
              <span class="type-badge">{v.typeId}</span>
              <span class="mode-badge">{v.layout}</span>
              <span class="spacer"></span>
              <button class="row-btn" title="Move up" aria-label="Move up" disabled={i === 0} onclick={() => move(section.items, i, -1)}>↑</button>
              <button class="row-btn" title="Move down" aria-label="Move down" disabled={i === section.items.length - 1} onclick={() => move(section.items, i, 1)}>↓</button>
              <button class="row-btn" onclick={() => startRename(v)}>Rename</button>
              <button class="row-btn" onclick={() => remove(v)}>Delete</button>
            </li>
          {/each}
        </ul>
      {/each}
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
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .dialog {
    width: 520px;
    max-width: 90vw;
    max-height: 80vh;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  }
  .title { margin: 0 0 12px; font-size: 15px; color: var(--text); }
  .empty { color: var(--text-faint); font-size: 13px; }
  .section-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-faint);
    margin: 12px 0 4px;
  }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border-radius: 6px;
  }
  .row:hover { background: color-mix(in oklch, var(--text) 4%, transparent); }
  .name { font-size: 13px; color: var(--text); cursor: text; }
  .name-input {
    font-size: 13px;
    padding: 2px 6px;
    background: var(--bg-inset);
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: var(--text);
    font-family: inherit;
  }
  .type-badge, .mode-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: color-mix(in oklch, var(--text) 6%, transparent);
    color: var(--text-faint);
  }
  .spacer { flex: 1; }
  .row-btn {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text-muted);
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .row-btn:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }
  .row-btn:disabled { opacity: 0.4; cursor: default; }
  .actions { display: flex; justify-content: flex-end; margin-top: 16px; }
  .btn {
    padding: 6px 16px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-button);
    color: var(--text);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .btn:hover { border-color: var(--accent); }
</style>
