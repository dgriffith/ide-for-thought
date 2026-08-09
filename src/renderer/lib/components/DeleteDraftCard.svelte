<script lang="ts">
  /**
   * Review card for a batch deletion from `propose_note_delete` or
   * `propose_folder_delete`. Lists each note with the dangling-link blast radius
   * — how many notes outside the deletion set link into it — so the user deletes
   * with eyes open. No danger styling: deletion is a normal, git-backed
   * operation here.
   *
   * The selection UNIT differs by draft kind (#1778). A note delete selects
   * notes. A folder delete is all-or-nothing per folder (the handler files one
   * `folder-delete` payload per folder, which takes the assets too), so the
   * checkboxes sit on the folder headings and `onApprove` hands back FOLDER
   * paths. A lone folder has nothing to choose between and renders bare, as it
   * did before batching.
   */
  import type { ConversationDeleteDraft, DeleteDraftItem } from '../../../shared/conversation-refactor-drafts';
  import Icon from './Icon.svelte';

  interface Props {
    draft: ConversationDeleteDraft;
    onApprove: (selected: string[]) => void;
    onDiscard: () => void;
  }

  let { draft, onApprove, onDiscard }: Props = $props();

  const folders = $derived(draft.folderPaths ?? []);
  const isFolderDelete = $derived(folders.length > 0);
  /** Checkboxes only earn their place when there's an actual choice to make. */
  const selectable = $derived(isFolderDelete ? folders.length > 1 : true);

  /** Whatever the user is choosing between: folder paths, or note paths. */
  function unitsOf(d: ConversationDeleteDraft): string[] {
    return d.folderPaths?.length ? d.folderPaths : d.items.map((i) => i.path);
  }

  // Everything selected by default; the user opts units out. Keyed to the draft.
  // svelte-ignore state_referenced_locally
  let selected = $state<Set<string>>(new Set(unitsOf(draft)));
  let expanded = $state<Set<string>>(new Set());

  /** A note is in the deletion set when its own path (note delete) or its
   *  enclosing folder (folder delete) is selected. */
  const selectedItems = $derived(
    draft.items.filter((i) => selected.has(isFolderDelete ? (i.folder ?? '') : i.path)),
  );
  const allSelected = $derived(selected.size === unitsOf(draft).length);
  // Distinct other-notes left with dangling links across the SELECTED items.
  const danglingSources = $derived(
    new Set(selectedItems.flatMap((i) => i.inbound.map((b) => b.source))).size,
  );

  /** Notes grouped under each folder, in `folderPaths` order. */
  const groups = $derived(
    folders.map((folder) => ({ folder, items: draft.items.filter((i) => i.folder === folder) })),
  );

  function toggle(unit: string) {
    const next = new Set(selected);
    if (next.has(unit)) next.delete(unit); else next.add(unit);
    selected = next;
  }
  function toggleAll() {
    selected = allSelected ? new Set() : new Set(unitsOf(draft));
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
    // Folder deletes hand back folder paths — the handler's payload unit.
    onApprove(isFolderDelete ? folders.filter((f) => selected.has(f)) : selectedItems.map((i) => i.path));
  }
</script>

<div class="draft-card">
  <div class="draft-summary">
    <strong>
      {#if isFolderDelete}Delete folder{folders.length === 1 ? '' : 's'}{:else}Delete{/if}
    </strong>
    <span class="draft-note">
      {#if isFolderDelete}
        {#if folders.length === 1}
          <span class="path">{folders[0]}</span> ·
        {:else}
          {selected.size} of {folders.length} folders ·
        {/if}
        {selectedItems.length} note{selectedItems.length === 1 ? '' : 's'}{#if draft.assetCount}, {draft.assetCount} asset{draft.assetCount === 1 ? '' : 's'}{/if}
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

  {#if selectable}
    <button class="select-all" type="button" onclick={toggleAll}>
      <Icon name={allSelected ? 'check' : 'dot'} size={11} />
      {allSelected ? 'Deselect all' : 'Select all'}
    </button>
  {/if}

  <div class="items">
    {#if isFolderDelete}
      {#each groups as group (group.folder)}
        {@const isSel = selected.has(group.folder)}
        <div class="group" class:deselected={!isSel}>
          <div class="group-head">
            {#if selectable}
              <label class="check">
                <input type="checkbox" checked={isSel} onchange={() => toggle(group.folder)} />
              </label>
            {/if}
            <Icon name="folder" size={11} color="var(--text-muted)" />
            <span class="path">{group.folder}</span>
            <span class="count">{group.items.length} note{group.items.length === 1 ? '' : 's'}</span>
          </div>
          {#each group.items as item (item.path)}
            {@render noteRow(item, isSel, false)}
          {/each}
        </div>
      {/each}
    {:else}
      {#each draft.items as item (item.path)}
        {@render noteRow(item, selected.has(item.path), true)}
      {/each}
    {/if}
  </div>

  <div class="draft-actions">
    <button type="button" class="draft-btn primary" disabled={selectedItems.length === 0 && selected.size === 0} onclick={approve}>
      {#if isFolderDelete}
        Delete {folders.length === 1 ? 'folder' : `${selected.size} folders`}
      {:else}
        Delete {selectedItems.length}
      {/if}
    </button>
    <button type="button" class="draft-btn" onclick={onDiscard}>Discard</button>
  </div>
</div>

{#snippet noteRow(item: DeleteDraftItem, isSel: boolean, checkable: boolean)}
  {@const isExp = expanded.has(item.path)}
  {@const links = inboundCount(item)}
  <div class="item" class:deselected={!isSel}>
    <div class="item-row">
      {#if checkable}
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
{/snippet}

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
  .group { display: flex; flex-direction: column; gap: 2px; }
  .group + .group { margin-top: 6px; }
  .group.deselected { opacity: 0.45; }
  .group-head { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .group-head .path { color: var(--text); }
  .group-head .count { color: var(--text-faint); font-size: 11px; }
  .group .item { padding-left: 14px; }
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
