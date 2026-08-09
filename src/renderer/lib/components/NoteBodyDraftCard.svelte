<script lang="ts">
  /**
   * Review card for in-place note rewrites from `propose_note_body` (#938).
   * Unlike the refactor card (where the move is the point and the diff is
   * secondary), here the rewrite IS the point, so a single note's diff shows
   * expanded by default. Reuses `changedLines()` — the same positional line
   * diff the refactor card renders.
   *
   * A draft carries one entry per note, so a twenty-note rewrite is one card
   * and, on approve, one bundled proposal. With more than one note the diffs
   * start collapsed (twenty expanded diffs would bury the transcript) and each
   * gets a checkbox, matching the reorg/delete cards' select-then-approve
   * shape. Approve routes through the `note_rewrite` payload (#936); nothing is
   * written until then. No danger styling — rewriting a note is a normal edit.
   */
  import type { ConversationNoteBodyDraft } from '../../../shared/conversation-note-body-drafts';
  import DraftCard from './DraftCard.svelte';
  import Icon from './Icon.svelte';
  import { changedLines } from './refactor-diff';

  interface Props {
    draft: ConversationNoteBodyDraft;
    /** Paths the user kept ticked. */
    onApprove: (selected: string[]) => void;
    onDiscard: () => void;
  }

  let { draft, onApprove, onDiscard }: Props = $props();

  const multi = $derived(draft.items.length > 1);

  // Everything starts selected — the model proposed it and the user is
  // reviewing, not assembling.
  // Intentional one-time seed from `draft`; card is keyed to the draft.
  // svelte-ignore state_referenced_locally
  let selected = $state<Set<string>>(new Set(draft.items.map((i) => i.relativePath)));
  // A lone rewrite shows its diff immediately; a batch stays collapsed until
  // asked for, so the card stays scannable.
  // svelte-ignore state_referenced_locally
  let expanded = $state<Set<string>>(
    new Set(draft.items.length === 1 ? draft.items.map((i) => i.relativePath) : []),
  );

  interface Row {
    path: string;
    lines: ReturnType<typeof changedLines>;
    added: number;
    removed: number;
  }

  const rows = $derived<Row[]>(
    draft.items.map((i) => {
      const lines = changedLines(i.beforeContent, i.afterContent);
      return {
        path: i.relativePath,
        lines,
        // Count each side independently — an expansion is mostly additions, a
        // trim mostly removals; both numbers say which at a glance.
        added: lines.filter((l) => l.after !== '').length,
        removed: lines.filter((l) => l.before !== '').length,
      };
    }),
  );

  const selectedRows = $derived(rows.filter((r) => selected.has(r.path)));
  const totalAdded = $derived(selectedRows.reduce((n, r) => n + r.added, 0));
  const totalRemoved = $derived(selectedRows.reduce((n, r) => n + r.removed, 0));

  // The rationale the tool passed, shown only when it adds something over the
  // generated default (which the header already conveys).
  const generatedDefault = $derived(
    draft.items.length === 1 ? `Rewrite ${draft.items[0]!.relativePath}` : `Rewrite ${draft.items.length} notes`,
  );
  const rationale = $derived(draft.note && draft.note !== generatedDefault ? draft.note : '');

  function toggleSelected(path: string): void {
    if (selected.has(path)) selected.delete(path);
    else selected.add(path);
    selected = new Set(selected);
  }
  function toggleExpanded(path: string): void {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    expanded = new Set(expanded);
  }
</script>

<DraftCard
  headline="Rewrite"
  note={multi ? `${draft.items.length} notes` : draft.items[0]?.relativePath ?? ''}
  approveLabel={selectedRows.length > 1 ? `Approve & rewrite ${selectedRows.length}` : 'Approve & rewrite'}
  approveDisabled={selectedRows.length === 0}
  onApprove={() => onApprove(selectedRows.map((r) => r.path))}
  {onDiscard}
>
  <div class="body">
    <div class="summary">
      {#if rationale}<span class="rationale">{rationale}</span>{/if}
      <span class="counts">
        <span class="add">+{totalAdded}</span> <span class="rem">−{totalRemoved}</span>
        line{totalAdded + totalRemoved === 1 ? '' : 's'} changed
        {#if multi}across {selectedRows.length} note{selectedRows.length === 1 ? '' : 's'}{/if}
      </span>
    </div>

    {#if draft.warnings.length > 0}
      <!-- Notes the tool couldn't include. Stated rather than silently dropped,
           so a batch that came back smaller than asked explains itself. -->
      <ul class="warnings">
        {#each draft.warnings as w}<li>{w}</li>{/each}
      </ul>
    {/if}

    {#each rows as row (row.path)}
      <div class="item">
        <div class="item-head">
          {#if multi}
            <label class="pick">
              <input
                type="checkbox"
                checked={selected.has(row.path)}
                onchange={() => toggleSelected(row.path)}
              />
              <span class="path">{row.path}</span>
            </label>
          {/if}
          <button class="toggle" type="button" onclick={() => toggleExpanded(row.path)}>
            <Icon name={expanded.has(row.path) ? 'chevronDown' : 'chevronRight'} size={11} />
            {expanded.has(row.path) ? 'Hide diff' : 'Show diff'}
          </button>
          {#if multi}
            <span class="item-counts">
              <span class="add">+{row.added}</span> <span class="rem">−{row.removed}</span>
            </span>
          {/if}
        </div>

        {#if expanded.has(row.path)}
          {#if row.lines.length === 0}
            <div class="empty">No line-level changes.</div>
          {:else}
            <div class="diff">
              {#each row.lines as line}
                {#if line.before !== ''}<div class="line removed">{line.before}</div>{/if}
                {#if line.after !== ''}<div class="line added">{line.after}</div>{/if}
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
</DraftCard>

<style>
  .body { display: flex; flex-direction: column; gap: 6px; }
  .summary { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 12.5px; }
  .rationale { color: var(--text); }
  .counts { color: var(--text-muted); font-size: 11.5px; }
  .add { color: var(--sage); }
  .rem { color: var(--text-muted); }
  .warnings {
    margin: 0; padding-left: 16px;
    font-size: 11.5px; color: var(--text-muted);
  }
  .item { display: flex; flex-direction: column; gap: 4px; }
  .item-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .pick { display: flex; align-items: center; gap: 5px; cursor: pointer; min-width: 0; }
  .path {
    font-family: var(--font-mono); font-size: 11.5px; color: var(--text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .item-counts { font-size: 11px; margin-left: auto; }
  .toggle {
    display: inline-flex; align-items: center; gap: 4px;
    border: none; background: none; padding: 0; cursor: pointer;
    color: var(--text-muted); font-size: 11.5px;
  }
  .toggle:hover { color: var(--text); }
  .empty { font-size: 11.5px; color: var(--text-faint); }
  /* Scroll-contain so a large rewrite doesn't blow out the transcript. */
  .diff {
    display: flex; flex-direction: column;
    border-left: 2px solid var(--border); padding-left: 8px;
    max-height: 340px; overflow-y: auto;
  }
  .line {
    font-family: var(--font-mono); font-size: 11px;
    white-space: pre-wrap; word-break: break-word;
    padding: 0 4px; border-radius: 2px;
  }
  /* Quiet add/remove tints — no alarm red; removed leans muted, added leans sage. */
  .line.removed { color: var(--text-muted); background: color-mix(in oklch, var(--text) 6%, transparent); }
  .line.added { color: var(--text); background: color-mix(in oklch, var(--sage) 14%, transparent); }
</style>
