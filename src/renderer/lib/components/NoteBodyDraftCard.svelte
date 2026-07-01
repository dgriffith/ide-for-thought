<script lang="ts">
  /**
   * Review card for an in-place note rewrite from `propose_note_body` (#938) —
   * the first in-place-editing tool. Unlike the refactor card (where the move is
   * the point and the diff is secondary), here the rewrite IS the point, so the
   * before/after diff shows by default. Reuses `changedLines()` — the same
   * positional line diff the refactor card renders. Approve routes through the
   * `note_rewrite` approval payload (#936); nothing is written until then. No
   * danger styling — rewriting a note is a normal edit, and it's git-backed.
   */
  import type { ConversationNoteBodyDraft } from '../../../shared/conversation-note-body-drafts';
  import DraftCard from './DraftCard.svelte';
  import Icon from './Icon.svelte';
  import { changedLines } from './refactor-diff';

  interface Props {
    draft: ConversationNoteBodyDraft;
    onApprove: () => void;
    onDiscard: () => void;
  }

  let { draft, onApprove, onDiscard }: Props = $props();

  let expanded = $state(true);

  const lines = $derived(changedLines(draft.beforeContent, draft.afterContent));
  // Count each side independently — an expansion is mostly additions, a trim
  // mostly removals; showing both numbers tells the user which at a glance.
  const removed = $derived(lines.filter((l) => l.before !== '').length);
  const added = $derived(lines.filter((l) => l.after !== '').length);
  // The rationale the tool passed, shown only when it adds something over the
  // default "Rewrite <path>" (which the path slot already conveys).
  const rationale = $derived(
    draft.note && draft.note !== `Rewrite ${draft.relativePath}` ? draft.note : '',
  );
</script>

<DraftCard
  headline="Rewrite"
  note={draft.relativePath}
  approveLabel="Approve & rewrite"
  {onApprove}
  {onDiscard}
>
  <div class="body">
    <div class="summary">
      {#if rationale}<span class="rationale">{rationale}</span>{/if}
      <span class="counts">
        <span class="add">+{added}</span> <span class="rem">−{removed}</span>
        line{added + removed === 1 ? '' : 's'} changed
      </span>
    </div>

    <button class="toggle" type="button" onclick={() => (expanded = !expanded)}>
      <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={11} />
      {expanded ? 'Hide diff' : 'Show diff'}
    </button>

    {#if expanded}
      {#if lines.length === 0}
        <div class="empty">No line-level changes.</div>
      {:else}
        <div class="diff">
          {#each lines as line}
            {#if line.before !== ''}<div class="line removed">{line.before}</div>{/if}
            {#if line.after !== ''}<div class="line added">{line.after}</div>{/if}
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</DraftCard>

<style>
  .body { display: flex; flex-direction: column; gap: 6px; }
  .summary { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 12.5px; }
  .rationale { color: var(--text); }
  .counts { color: var(--text-muted); font-size: 11.5px; }
  .counts .add { color: var(--sage); }
  .counts .rem { color: var(--text-muted); }
  .toggle {
    display: inline-flex; align-items: center; gap: 4px; align-self: flex-start;
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
