<script lang="ts">
  /**
   * Review card for a batch note-deletion from `propose_note_delete`. Lists each
   * note with per-item checkboxes (approve a subset) and surfaces the dangling-
   * link blast radius — how many notes outside the deletion set link into each
   * one — so the user deletes with eyes open. Approve removes only the selected
   * notes. No danger styling: deletion is a normal, git-backed operation here.
   */
  import type { ConversationDeleteDraft, DeleteDraftItem } from '../../../shared/conversation-refactor-drafts';
  import Icon from './Icon.svelte';

  interface Props {
    draft: ConversationDeleteDraft;
    onApprove: (selected: string[]) => void;
    onDiscard: () => void;
  }

  let { draft, onApprove, onDiscard }: Props = $props();

  // Everything selected by default; the user opts items out. Keyed to the draft.
  // svelte-ignore state_referenced_locally
  let selected = $state<Set<string>>(new Set(draft.items.map((i) => i.path)));
  let expanded = $state<Set<string>>(new Set());

  const selectedItems = $derived(draft.items.filter((i) => selected.has(i.path)));
  const allSelected = $derived(selected.size === draft.items.length);
  // Distinct other-notes left with dangling links across the SELECTED items.
  const danglingSources = $derived(
    new Set(selectedItems.flatMap((i) => i.inbound.map((b) => b.source))).size,
  );

  function toggle(path: string) {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path); else next.add(path);
    selected = next;
  }
  function toggleAll() {
    selected = allSelected ? new Set() : new Set(draft.items.map((i) => i.path));
  }
  function toggleExpand(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path); else next.add(path);
    expanded = next;
  }
  function inboundCount(item: DeleteDraftItem): number {
    return item.inbound.reduce((n, b) => n + b.linkCount, 0);
  }
  function approve() {
    onApprove(selectedItems.map((i) => i.path));
  }
</script>

<div class="draft-card">
  <div class="draft-summary">
    <strong>{draft.folderPath ? 'Delete folder' : 'Delete'}</strong>
    <span class="draft-note">
      {#if draft.folderPath}
        <span class="path">{draft.folderPath}</span> · {draft.items.length} note{draft.items.length === 1 ? '' : 's'}{#if draft.assetCount}, {draft.assetCount} asset{draft.assetCount === 1 ? '' : 's'}{/if}
      {:else}
        {selectedItems.length} of {draft.items.length} note{draft.items.length === 1 ? '' : 's'}
      {/if}
      {#if danglingSources > 0}
        · {danglingSources} other note{danglingSources === 1 ? '' : 's'} will have dangling links
      {/if}
    </span>
  </div>

  {#if draft.warnings.length > 0}
    <div class="warnings">
      {#each draft.warnings as w}
        <div class="warning"><Icon name="warn" size={11} color="var(--rust)" /> {w}</div>
      {/each}
    </div>
  {/if}

  {#if !draft.folderPath}
    <button class="select-all" type="button" onclick={toggleAll}>
      <Icon name={allSelected ? 'check' : 'dot'} size={11} />
      {allSelected ? 'Deselect all' : 'Select all'}
    </button>
  {/if}

  <div class="items">
    {#each draft.items as item (item.path)}
      {@const isSel = draft.folderPath ? true : selected.has(item.path)}
      {@const isExp = expanded.has(item.path)}
      {@const links = inboundCount(item)}
      <div class="item" class:deselected={!isSel}>
        <div class="item-row">
          {#if !draft.folderPath}
          <label class="check">
            <input type="checkbox" checked={isSel} onchange={() => toggle(item.path)} />
          </label>
          {/if}
          <span class="paths" title={item.path}>
            <span class="title">{item.title}</span>
            <span class="path">{item.path}</span>
          </span>
          {#if links > 0}
            <button class="links-badge" type="button" onclick={() => toggleExpand(item.path)} title="Show linking notes">
              <Icon name={isExp ? 'chevronDown' : 'chevronRight'} size={9} />
              {links} inbound link{links === 1 ? '' : 's'}
            </button>
          {/if}
        </div>
        {#if isExp && item.inbound.length > 0}
          <div class="inbound">
            {#each item.inbound as b (b.source)}
              <div class="inbound-row" title={b.source}>
                <Icon name="link" size={10} color="var(--text-faint)" />
                <span class="src">{b.sourceTitle}</span>
                {#if b.linkCount > 1}<span class="count">×{b.linkCount}</span>{/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="draft-actions">
    <button type="button" class="draft-btn primary" disabled={!draft.folderPath && selectedItems.length === 0} onclick={approve}>
      {draft.folderPath ? 'Delete folder' : `Delete ${selectedItems.length}`}
    </button>
    <button type="button" class="draft-btn" onclick={onDiscard}>Discard</button>
  </div>
</div>

<style>
  .draft-card {
    border: 1px solid color-mix(in oklch, var(--accent) 28%, transparent);
    border-radius: 8px;
    padding: 10px 12px;
    background: color-mix(in oklch, var(--accent) 5%, var(--bg));
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .draft-summary { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .draft-note { color: var(--text-muted); font-size: 12px; }
  .warnings { display: flex; flex-direction: column; gap: 3px; }
  .warning {
    display: flex; align-items: center; gap: 5px;
    font-size: 11.5px; color: var(--text-muted);
  }
  .select-all {
    display: inline-flex; align-items: center; gap: 4px; align-self: flex-start;
    border: none; background: none; padding: 0; cursor: pointer;
    color: var(--text-muted); font-size: 11.5px;
  }
  .select-all:hover { color: var(--text); }
  .items { display: flex; flex-direction: column; gap: 2px; max-height: 320px; overflow-y: auto; }
  .item { border-radius: 4px; padding: 2px 0; }
  .item.deselected { opacity: 0.5; }
  .item-row { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .check { display: inline-flex; }
  .paths {
    flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden;
  }
  .title {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text); font-size: 12px;
  }
  .path {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--font-mono); font-size: 10px; color: var(--text-faint);
  }
  .links-badge {
    flex-shrink: 0; align-self: center;
    display: inline-flex; align-items: center; gap: 2px;
    border: none; background: none; cursor: pointer; padding: 0;
    color: var(--text-faint); font-size: 10px;
  }
  .links-badge:hover { color: var(--text-muted); }
  .inbound { display: flex; flex-direction: column; gap: 2px; padding: 4px 0 4px 24px; }
  .inbound-row {
    display: flex; align-items: center; gap: 5px;
    font-size: 10.5px; color: var(--text-muted);
  }
  .inbound-row .src { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inbound-row .count { color: var(--text-faint); }
  .draft-actions { display: flex; gap: 6px; justify-content: flex-end; }
  .draft-btn {
    padding: 4px 10px; border: 1px solid var(--border); border-radius: 3px;
    background: none; color: var(--text); cursor: pointer; font-size: 12px;
  }
  .draft-btn:hover:not(:disabled) { background: var(--bg, var(--bg-sidebar)); }
  .draft-btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .draft-btn.primary:hover:not(:disabled) { background: var(--accent); opacity: 0.9; }
  .draft-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
