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
   */
  import type { SafeDeleteBlocker } from '../../../shared/types';

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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Safe Delete — external references found">
    <header class="card-header">
      <div class="eyebrow">SAFE DELETE · {blockedTargetCount} of {targets.length} blocked</div>
      <h2 class="title">
        {#if blockedTargetCount === 1}
          1 note has external references
        {:else}
          {blockedTargetCount} notes have external references
        {/if}
      </h2>
      <p class="sub">
        {totalLinks} inbound link{totalLinks === 1 ? '' : 's'} from
        {selectionCount === 1 ? 'this selection' : 'outside the selection'}
        would become broken. Fix or remove the reference{totalLinks === 1 ? '' : 's'}, then retry —
        or override with <em>Delete anyway</em>.
      </p>
    </header>

    <div class="body">
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
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel</span>
      <span class="footer-actions">
        <button class="btn ghost" onclick={onCancel}>Cancel</button>
        <button
          class="btn ghost"
          disabled={!firstBlocker}
          onclick={() => firstBlocker && onOpenFirstReference(firstBlocker.source, firstBlocker.target)}
        >
          Open first reference
        </button>
        <button class="btn primary" onclick={onDeleteAnyway}>Delete anyway</button>
      </span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: rgba(20, 14, 6, 0.5);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    width: 640px;
    max-width: 100%;
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-sans);
    color: var(--text);
  }
  .card-header {
    padding: 20px 24px 8px;
  }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    margin-bottom: 6px;
    text-transform: uppercase;
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 500;
    letter-spacing: -0.005em;
    line-height: 1.3;
  }
  .sub {
    margin: 6px 0 0;
    font-size: 12.5px;
    color: var(--text-muted);
    line-height: 1.45;
  }
  .body {
    padding: 12px 24px 18px;
    overflow: auto;
    flex: 1;
  }
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

  .card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
  }
  .kbd-hint {
    margin-right: auto;
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .footer-actions {
    display: inline-flex;
    gap: 8px;
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
