<script lang="ts">
  /**
   * Review card for a batch reorganization plan (#914). Many moves/renames as one
   * card: a combined blast-radius summary, per-item checkboxes (approve a subset),
   * an expandable per-item diff, and any plan-level warnings (collisions, cycles).
   * Approve applies only the selected items as one ordered, atomic bundle.
   */
  import type { ConversationReorgDraft, ReorgDraftItem } from '../../../shared/conversation-refactor-drafts';
  import Icon from './Icon.svelte';
  import { refactorVerb, changedLines } from './refactor-diff';

  interface Props {
    draft: ConversationReorgDraft;
    onApprove: (selected: Array<{ fromPath: string; toPath: string }>) => void;
    onDiscard: () => void;
  }

  let { draft, onApprove, onDiscard }: Props = $props();

  // Everything selected by default; the user opts items out.
  let selected = $state<Set<string>>(new Set(draft.items.map((i) => i.fromPath)));
  let expanded = $state<Set<string>>(new Set());

  const selectedItems = $derived(draft.items.filter((i) => selected.has(i.fromPath)));
  const allSelected = $derived(selected.size === draft.items.length);
  // Distinct other-notes whose links get rewritten across the SELECTED items.
  const linkRewrites = $derived(
    new Set(selectedItems.flatMap((i) => i.affectedNotes.filter((a) => !a.isMoved).map((a) => a.path))).size,
  );

  function toggle(fromPath: string) {
    const next = new Set(selected);
    if (next.has(fromPath)) next.delete(fromPath); else next.add(fromPath);
    selected = next;
  }
  function toggleAll() {
    selected = allSelected ? new Set() : new Set(draft.items.map((i) => i.fromPath));
  }
  function toggleExpand(fromPath: string) {
    const next = new Set(expanded);
    if (next.has(fromPath)) next.delete(fromPath); else next.add(fromPath);
    expanded = next;
  }
  function otherCount(item: ReorgDraftItem): number {
    return item.affectedNotes.filter((a) => !a.isMoved).length;
  }
  function approve() {
    onApprove(selectedItems.map((i) => ({ fromPath: i.fromPath, toPath: i.toPath })));
  }
</script>

<div class="draft-card">
  <div class="draft-summary">
    <strong>Reorganize</strong>
    <span class="draft-note">{selectedItems.length} of {draft.items.length} notes · {linkRewrites} note{linkRewrites === 1 ? '' : 's'}' links rewritten</span>
  </div>

  {#if draft.warnings.length > 0}
    <div class="warnings">
      {#each draft.warnings as w}
        <div class="warning"><Icon name="warn" size={11} color="var(--rust)" /> {w}</div>
      {/each}
    </div>
  {/if}

  <button class="select-all" type="button" onclick={toggleAll}>
    <Icon name={allSelected ? 'check' : 'dot'} size={11} />
    {allSelected ? 'Deselect all' : 'Select all'}
  </button>

  <div class="items">
    {#each draft.items as item (item.fromPath)}
      {@const isSel = selected.has(item.fromPath)}
      {@const isExp = expanded.has(item.fromPath)}
      <div class="item" class:deselected={!isSel}>
        <div class="item-row">
          <label class="check">
            <input type="checkbox" checked={isSel} onchange={() => toggle(item.fromPath)} />
          </label>
          <span class="verb">{refactorVerb(item.fromPath, item.toPath)}</span>
          <span class="paths" title="{item.fromPath} → {item.toPath}">{item.fromPath} → {item.toPath}</span>
          {#if otherCount(item) > 0}
            <button class="links-badge" type="button" onclick={() => toggleExpand(item.fromPath)} title="Show link changes">
              <Icon name={isExp ? 'chevronDown' : 'chevronRight'} size={9} />
              {otherCount(item)} link{otherCount(item) === 1 ? '' : 's'}
            </button>
          {/if}
        </div>
        {#if isExp}
          <div class="diffs">
            {#each item.affectedNotes as note (note.path)}
              <div class="file-diff">
                <div class="file-path">{note.path}{#if note.isMoved}<span class="self"> · this note</span>{/if}</div>
                {#each changedLines(note.before, note.after) as line}
                  <div class="line removed">{line.before}</div>
                  <div class="line added">{line.after}</div>
                {/each}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="draft-actions">
    <button type="button" class="draft-btn primary" disabled={selectedItems.length === 0} onclick={approve}>
      Approve {selectedItems.length}
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
  .verb { color: var(--text-muted); font-size: 10.5px; width: 44px; flex-shrink: 0; }
  .paths {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--font-mono); font-size: 11px; color: var(--text);
  }
  .links-badge {
    flex-shrink: 0;
    display: inline-flex; align-items: center; gap: 2px;
    border: none; background: none; cursor: pointer; padding: 0;
    color: var(--text-faint); font-size: 10px;
  }
  .links-badge:hover { color: var(--text-muted); }
  .diffs { display: flex; flex-direction: column; gap: 6px; padding: 4px 0 4px 24px; }
  .file-diff { border-left: 2px solid var(--border); padding-left: 8px; }
  .file-path { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); margin-bottom: 2px; }
  .self { color: var(--text-faint); }
  .line {
    font-family: var(--font-mono); font-size: 10.5px; white-space: pre-wrap; word-break: break-word;
    padding: 0 4px; border-radius: 2px;
  }
  .line.removed { color: var(--text-muted); background: color-mix(in oklch, var(--text) 6%, transparent); }
  .line.added { color: var(--text); background: color-mix(in oklch, var(--sage) 14%, transparent); }
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
