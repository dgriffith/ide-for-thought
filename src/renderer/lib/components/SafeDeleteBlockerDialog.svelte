<script lang="ts">
  /**
   * Pre-flight block (#429) for Safe Delete. Shown when at least one
   * selected note has an inbound link from outside the delete set —
   * deleting would silently break that link.
   *
   * Three exits:
   *   Cancel               — close, do nothing.
   *   Delete anyway        — bypass to the original delete path.
   *   Open first reference — open the first linking note so the user
   *                          can fix the reference and retry.
   *
   * No "Don't ask again" — every delete with external blockers should
   * surface; that's the whole point of safe-by-default. The earlier
   * "Delete N notes?" confirm still has its own suppression for the
   * no-blocker case.
   *
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and
   * backdrop-click are Dialog's job. The accessible name moves from a
   * static `aria-label` to the actual h2 title text via `titleId` — more
   * accurate (it now includes the note count), and nothing asserts the
   * old static string.
   */
  import type { SafeDeleteBlocker } from '../../../shared/types';
  import Dialog from './ui/Dialog.svelte';

  interface Props {
    /** Number of items the user originally selected (folders count once). */
    selectionCount: number;
    /** All `.md` paths in the delete set. Used to report "N of M blocked". */
    targets: string[];
    /** External inbound rows from `findExternalInboundLinks`. */
    blockers: SafeDeleteBlocker[];
    onCancel: () => void;
    onDeleteAnyway: () => void;
    /** Source + target of the first row, for "Open first reference". */
    onOpenFirstReference: (source: string, target: string) => void;
  }

  let { selectionCount, targets, blockers, onCancel, onDeleteAnyway, onOpenFirstReference }: Props = $props();

  // Group blockers by target for the display.
  const grouped = $derived.by(() => {
    const m = new Map<string, SafeDeleteBlocker[]>();
    for (const b of blockers) {
      const arr = m.get(b.target) ?? [];
      arr.push(b);
      m.set(b.target, arr);
    }
    return [...m.entries()];
  });

  const blockedTargetCount = $derived(grouped.length);
  const totalLinks = $derived(blockers.reduce((n, b) => n + b.linkCount, 0));
  const firstBlocker = $derived(blockers[0] ?? null);
</script>

<Dialog width={640} onClose={onCancel} titleId="safe-delete-blocker-title">
  {#snippet eyebrow()}SAFE DELETE · {blockedTargetCount} of {targets.length} blocked{/snippet}
  {#snippet title()}
    {#if blockedTargetCount === 1}
      1 note has external references
    {:else}
      {blockedTargetCount} notes have external references
    {/if}
  {/snippet}
  {#snippet subtitle()}
    {totalLinks} inbound link{totalLinks === 1 ? '' : 's'} from
    {selectionCount === 1 ? 'this selection' : 'outside the selection'}
    would become broken. Fix or remove the reference{totalLinks === 1 ? '' : 's'}, then retry —
    or override with <em>Delete anyway</em>.
  {/snippet}
  {#snippet body()}
    <div class="list">
      {#each grouped as [target, rows] (target)}
        <div class="group">
          <div class="group-head">{target}</div>
          <div class="group-sub">referenced by:</div>
          <ul class="refs">
            {#each rows as r (r.source)}
              <li>
                <span class="src">{r.source}</span>
                <span class="meta">
                  {#if r.linkLabel}
                    <span class="label">{r.linkLabel}</span> ·
                  {/if}
                  {r.linkCount} link{r.linkCount === 1 ? '' : 's'}
                </span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  {/snippet}
  {#snippet footerLeft()}<span class="kbd-hint">esc · cancel</span>{/snippet}
  {#snippet footerRight()}
    <button class="btn ghost" onclick={onCancel}>Cancel</button>
    <button
      class="btn ghost"
      disabled={!firstBlocker}
      onclick={() => firstBlocker && onOpenFirstReference(firstBlocker.source, firstBlocker.target)}
    >
      Open first reference
    </button>
    <button class="btn primary" onclick={onDeleteAnyway}>Delete anyway</button>
  {/snippet}
</Dialog>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .group {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--bg);
  }
  .group-head {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text);
    word-break: break-all;
  }
  .group-sub {
    font-size: 11px;
    color: var(--text-faint);
    margin: 2px 0 6px;
  }
  .refs {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .refs li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: 12.5px;
  }
  .src {
    font-family: var(--font-mono);
    color: var(--text);
    word-break: break-all;
  }
  .meta {
    color: var(--text-faint);
    font-size: 11.5px;
    margin-left: auto;
    white-space: nowrap;
  }
  .label {
    color: var(--text-muted);
  }

  .kbd-hint {
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .btn {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
  }
  .ghost {
    background: transparent;
    color: var(--text-muted);
  }
  .ghost:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .ghost:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* "primary" per CLAUDE.md — destructive verbs stay on accent, not red. */
  .primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .primary:hover {
    opacity: 0.92;
  }
</style>
