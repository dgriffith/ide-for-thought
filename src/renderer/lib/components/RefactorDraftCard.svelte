<script lang="ts">
  /**
   * Review card for a note move/rename proposal (#913). A refactor is a
   * structural change with a fan-out — one move plus link rewrites across N other
   * notes — so the card leads with the destination and the blast radius, with an
   * expandable per-file diff (rendered from the dry-run the tool already computed;
   * nothing is recomputed on approve). No danger styling: a move is normal.
   */
  import type { ConversationRefactorDraft } from '../../../shared/conversation-refactor-drafts';
  import DraftCard from './DraftCard.svelte';
  import Icon from './Icon.svelte';
  import { refactorVerb, changedLines } from './refactor-diff';

  interface Props {
    draft: ConversationRefactorDraft;
    onApprove: () => void;
    onDiscard: () => void;
  }

  let { draft, onApprove, onDiscard }: Props = $props();

  let expanded = $state(false);

  const verb = $derived(refactorVerb(draft.fromPath, draft.toPath));
  const isRename = $derived(verb === 'Rename');
  // Other notes whose inbound links get rewritten (excludes the moved note itself).
  const otherNotes = $derived(draft.affectedNotes.filter((a) => !a.isMoved));
</script>

<DraftCard
  headline={verb}
  note="{draft.fromPath} → {draft.toPath}"
  approveLabel={isRename ? 'Approve & rename' : 'Approve & move'}
  {onApprove}
  {onDiscard}
>
  <div class="refactor-body">
    <div class="blast" class:none={otherNotes.length === 0}>
      {#if otherNotes.length === 0}
        No other notes link here — only the note moves.
      {:else}
        <strong>{otherNotes.length}</strong> note{otherNotes.length === 1 ? '' : 's'} will have links rewritten.
      {/if}
    </div>

    {#if draft.affectedNotes.length > 0}
      <button class="toggle" type="button" onclick={() => (expanded = !expanded)}>
        <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={11} />
        {expanded ? 'Hide changes' : 'Show changes'}
      </button>
      {#if expanded}
        <div class="diffs">
          {#each draft.affectedNotes as note (note.path)}
            <div class="file-diff">
              <div class="file-path">
                {note.path}{#if note.isMoved}<span class="self"> · this note</span>{/if}
              </div>
              {#each changedLines(note.before, note.after) as line}
                <div class="line removed">{line.before}</div>
                <div class="line added">{line.after}</div>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</DraftCard>

<style>
  .refactor-body { display: flex; flex-direction: column; gap: 6px; }
  .blast { font-size: 12.5px; color: var(--text); }
  .blast.none { color: var(--text-muted); }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    align-self: flex-start;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 11.5px;
  }
  .toggle:hover { color: var(--text); }
  .diffs { display: flex; flex-direction: column; gap: 8px; }
  .file-diff {
    border-left: 2px solid var(--border);
    padding-left: 8px;
  }
  .file-path {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
    margin-bottom: 2px;
  }
  .self { color: var(--text-faint); }
  .line {
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    padding: 0 4px;
    border-radius: 2px;
  }
  /* Quiet add/remove tints — no alarm red; removed leans muted, added leans sage. */
  .line.removed { color: var(--text-muted); background: color-mix(in oklch, var(--text) 6%, transparent); }
  .line.added { color: var(--text); background: color-mix(in oklch, var(--sage) 14%, transparent); }
</style>
