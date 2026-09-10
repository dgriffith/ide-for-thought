<script lang="ts">
  /**
   * Multi-file/directory local history (#2092, epic #2088) — IntelliJ-style
   * "Local History" over a sidebar selection instead of a single note: a
   * merged timeline across every note underneath (live or orphaned/deleted),
   * a client-side preview of a point-in-time revert before committing, a
   * single-file diff for whichever row is focused, and the batch revert
   * itself.
   *
   * Renders via `ui/Dialog.svelte` (#1888/#2047) — backdrop-click and
   * Escape-to-close are Dialog's job. Flat under `components/` and
   * self-gated on the store's `open` flag, mounted unconditionally in
   * App.svelte. The store owns the `HISTORY_CHANGED` subscription and the
   * two IPC calls (`listUnified`, `batchRevert`); this component owns only
   * view state (which point in time is picked, which path is focused for
   * its diff) plus two direct reads (a revision's content, a live file's
   * current content) — reads are allowed in components per CLAUDE.md's data-
   * flow rule.
   */
  import Dialog from './ui/Dialog.svelte';
  import { getMultiFileHistoryStore } from '../stores/multi-file-history.svelte';
  import { getDialogStore } from '../stores/dialogs.svelte';
  import { api } from '../ipc/client';
  import { formatDateTime } from '../../../shared/format-datetime';
  import { diffLines, diffStats } from '../history/line-diff';
  import { previewRevert, type PathPreview } from '../history/multi-file-preview';
  import { describeRevisionCause, resolveAsOf, type UnifiedTimelineEntry } from '../../../shared/history';
  import { formatCappedList } from '../app/text-helpers';
  import { CONFIRM_KEYS } from '../confirm-keys';

  const store = getMultiFileHistoryStore();
  const { showConfirm } = getDialogStore();

  let selectedTs = $state<number | null>(null);
  let focusedPath = $state<string | null>(null);
  let focusedBefore = $state<string | null>(null);
  let focusedAfter = $state<string | null>(null);

  const preview = $derived<PathPreview[]>(
    selectedTs === null ? [] : previewRevert(store.timeline, selectedTs),
  );
  const diff = $derived(diffLines(focusedBefore ?? '', focusedAfter ?? ''));
  const stats = $derived(diffStats(diff));
  const isIdentical = $derived(focusedBefore !== null && focusedBefore === focusedAfter);

  async function loadFocusedDiff(path: string, ts: number): Promise<void> {
    const entries = store.timeline.filter((e) => e.path === path);
    const asOf = resolveAsOf(entries, ts);
    const before = asOf === 'absent' || asOf === 'deleted' ? null : await api.history.getRevision(path, asOf.ts);
    let after: string | null;
    try {
      after = await api.notebase.readFile(path);
    } catch {
      after = null;
    }
    // The dialog may have closed, or a different row may have been picked,
    // while these reads were in flight.
    if (focusedPath !== path || selectedTs !== ts) return;
    focusedBefore = before;
    focusedAfter = after;
  }

  function selectEntry(entry: UnifiedTimelineEntry): void {
    selectedTs = entry.ts;
    focusedPath = entry.path;
    focusedBefore = null;
    focusedAfter = null;
    void loadFocusedDiff(entry.path, entry.ts);
  }

  function focusPath(path: string): void {
    if (selectedTs === null) return;
    focusedPath = path;
    focusedBefore = null;
    focusedAfter = null;
    void loadFocusedDiff(path, selectedTs);
  }

  function reset(): void {
    selectedTs = null;
    focusedPath = null;
    focusedBefore = null;
    focusedAfter = null;
  }

  function close(): void {
    store.close();
    reset();
  }

  async function revert(): Promise<void> {
    if (selectedTs === null) return;
    const ts = selectedTs;
    const result = await store.revert(ts);
    if (!result) return; // declined the confirm

    const parts: string[] = [];
    if (result.reverted.length) parts.push(`${result.reverted.length} reverted`);
    if (result.recreated.length) parts.push(`${result.recreated.length} undeleted`);
    if (result.removed.length) parts.push(`${result.removed.length} removed`);
    if (result.unchanged.length) parts.push(`${result.unchanged.length} unchanged`);
    if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
    let msg = parts.length > 0
      ? `Reverted to ${formatDateTime(result.ts)}: ${parts.join(', ')}.`
      : `Nothing to revert to ${formatDateTime(result.ts)}.`;
    if (result.errors.length > 0) {
      msg += `\n\nFailed (${result.errors.length}):\n${formatCappedList(result.errors, (e) => `• ${e.path}: ${e.error}`)}`;
    }
    await showConfirm(msg, CONFIRM_KEYS.multiFileHistoryRevertComplete, 'OK');
    reset();
  }

  function eventLabel(event: UnifiedTimelineEntry['event']): string {
    if (event === 'added') return 'added';
    if (event === 'deleted') return 'deleted';
    return 'modified';
  }

  function bucketLabel(bucket: PathPreview['bucket']): string {
    switch (bucket) {
      case 'reverted': return 'will revert';
      case 'recreated': return 'will undelete';
      case 'removed': return 'will remove';
      case 'unchanged': return 'no change';
      case 'skipped': return 'skipped';
    }
  }
</script>

{#if store.open}
  <Dialog width={860} onClose={close} titleId="multi-file-history-title">
    {#snippet eyebrow()}Local History{/snippet}
    {#snippet title()}{store.paths.length} note{store.paths.length === 1 ? '' : 's'} in selection{/snippet}
    {#snippet body()}
      {#if store.loading}
        <p class="empty">Loading…</p>
      {:else if store.error}
        <p class="empty">Couldn't read history: {store.error}</p>
      {:else if store.timeline.length === 0}
        <p class="empty">No history yet.</p>
      {:else}
        <div class="columns">
          <ul class="timeline">
            {#each store.timeline as entry (entry.path + ':' + entry.ts)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <li
                class:selected={entry.ts === selectedTs && entry.path === focusedPath}
                onclick={() => selectEntry(entry)}
              >
                <span class="when">{formatDateTime(entry.ts)}</span>
                <span class="event" class:deleted={entry.event === 'deleted'} class:added={entry.event === 'added'}>
                  {eventLabel(entry.event)}
                </span>
                <span class="path">{entry.path}</span>
                <span class="cause">{describeRevisionCause(entry)}</span>
              </li>
            {/each}
          </ul>

          {#if selectedTs !== null}
            <div class="detail">
              <div class="preview-head">
                <span>As of {formatDateTime(selectedTs)}:</span>
                <button class="btn primary" onclick={revert}>Revert selection…</button>
              </div>
              <ul class="preview">
                {#each preview as p (p.path)}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                  <li class:focused={p.path === focusedPath} onclick={() => focusPath(p.path)}>
                    <span class="path">{p.path}</span>
                    <span class="bucket {p.bucket}">{bucketLabel(p.bucket)}</span>
                  </li>
                {/each}
              </ul>

              {#if focusedPath !== null}
                <div class="diff-head">
                  {#if isIdentical}
                    <span class="same">Contents are identical.</span>
                  {:else}
                    <span class="counts"><span class="add">+{stats.added}</span> <span class="rem">−{stats.removed}</span></span>
                  {/if}
                </div>
                {#if !isIdentical}
                  <div class="diff">
                    {#each diff as line, i (i)}
                      <div class="line {line.type}"><span class="gutter">{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}</span>{line.text || ' '}</div>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    {/snippet}
    {#snippet footerLeft()}esc · close{/snippet}
    {#snippet footerRight()}
      <button class="btn secondary" onclick={close}>Close</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .empty { color: var(--text-muted); font-size: 13px; padding: 12px 0; }

  .columns { display: flex; gap: 16px; height: 55vh; }
  .timeline { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1 1 40%; min-width: 0; }
  .timeline li {
    display: grid; grid-template-columns: auto auto 1fr; align-items: baseline;
    column-gap: 8px; padding: 6px 8px; cursor: pointer;
    border-bottom: 1px solid var(--border); font-size: 12.5px;
  }
  .timeline li:hover { background: var(--bg-button); }
  .timeline li.selected { background: color-mix(in oklch, var(--accent) 14%, transparent); }
  .when { color: var(--text); white-space: nowrap; }
  .event {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; color: var(--text-muted);
  }
  .event.added { color: color-mix(in oklch, green 60%, var(--text)); }
  .event.deleted { color: var(--text-faint); font-style: italic; }
  .path {
    grid-column: 1 / -1; font-family: var(--font-mono); font-size: 11.5px; color: var(--text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cause { grid-column: 1 / -1; font-size: 11px; color: var(--text-muted); }

  .detail { flex: 1 1 60%; min-width: 0; display: flex; flex-direction: column; overflow: hidden; border-left: 1px solid var(--border); padding-left: 16px; }
  .preview-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
  .preview { list-style: none; margin: 0 0 8px; padding: 0; overflow-y: auto; max-height: 30%; flex: 0 0 auto; }
  .preview li {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 4px 6px; cursor: pointer; font-size: 12px; border-bottom: 1px solid var(--border);
  }
  .preview li:hover { background: var(--bg-button); }
  .preview li.focused { background: color-mix(in oklch, var(--accent) 14%, transparent); }
  .preview .path { font-family: var(--font-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bucket { font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }
  .bucket.reverted, .bucket.recreated { color: color-mix(in oklch, green 60%, var(--text)); }
  .bucket.removed { color: color-mix(in oklch, var(--text-muted) 70%, red); }
  .bucket.unchanged, .bucket.skipped { color: var(--text-faint); }

  .diff-head {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 0; border-top: 1px solid var(--border);
  }
  .counts { font-size: 12px; }
  .add { color: color-mix(in oklch, green 60%, var(--text)); }
  .rem { color: color-mix(in oklch, var(--text-muted) 80%, red); }
  .same { color: var(--text-muted); font-size: 12px; }
  .diff { overflow: auto; flex: 1 1 auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; }
  .line { display: flex; gap: 6px; padding: 0 4px; white-space: pre-wrap; word-break: break-word; }
  .line .gutter { flex: 0 0 auto; width: 0.9em; text-align: center; color: var(--text-faint); user-select: none; }
  .line.add { background: color-mix(in oklch, green 12%, transparent); }
  .line.remove { background: color-mix(in oklch, red 10%, transparent); color: var(--text-muted); }

  .btn { padding: 7px 14px; border: 1px solid var(--border); border-radius: 6px; font-size: 12.5px; font-family: inherit; cursor: pointer; }
  .secondary { background: transparent; color: var(--text-muted); }
  .secondary:hover { color: var(--text); border-color: var(--border-strong); }
  .primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
  .primary:hover:not(:disabled) { opacity: 0.92; }
</style>
