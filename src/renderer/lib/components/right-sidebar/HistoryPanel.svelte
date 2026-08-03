<script lang="ts">
  // Local per-note history (#1158, PR 2) — IntelliJ-style "Local History" for
  // the active note: a timeline of saved revisions, a diff of the selected one
  // against the current text, and one-click restore.
  //
  // Reads (`list` / `getRevision`) are direct `api.*` per the renderer data-flow
  // rule; restore is a mutation, so it routes out through `onRestore` (App owns
  // the confirm + the `api.history.restore` call).
  import { api } from '../../ipc/client';
  import { formatRelativeTime } from '../../utils/format-relative-time';
  import { diffLines, diffStats } from '../../history/line-diff';
  import type { RevisionMeta } from '../../../../shared/history';

  interface Props {
    activeFilePath: string | null;
    /** Current editor content — the diff's "after" and the change signal. */
    content: string;
    /** Bumps on reindex/save; a fresh revision appears after a save lands. */
    revision: number;
    /** Restore is a mutation — App shows the confirm and calls the IPC. */
    onRestore?: (relativePath: string, ts: number) => void | Promise<void>;
  }

  let { activeFilePath, content, revision, onRestore }: Props = $props();

  let revisions = $state<RevisionMeta[]>([]);
  let selectedTs = $state<number | null>(null);
  let selectedContent = $state<string | null>(null);
  let now = $state(Date.now());

  async function loadList(relativePath: string): Promise<void> {
    const list = await api.history.list(relativePath);
    revisions = list;
    now = Date.now();
    // Keep the selection if it still exists; else drop the (stale) diff.
    if (selectedTs !== null && !list.some((r) => r.ts === selectedTs)) {
      selectedTs = null;
      selectedContent = null;
    }
  }

  async function select(relativePath: string, ts: number): Promise<void> {
    selectedTs = ts;
    selectedContent = await api.history.getRevision(relativePath, ts);
  }

  // Reload when the note changes or a save/reindex bumps `revision`.
  $effect(() => {
    const p = activeFilePath;
    void revision; // dependency: refetch after a save lands a new revision
    if (!p) { revisions = []; selectedTs = null; selectedContent = null; return; }
    void loadList(p);
  });

  // Debounced refresh while editing, so a new revision surfaces shortly after a
  // pause even if `revision` didn't move.
  $effect(() => {
    const p = activeFilePath;
    void content;
    if (!p) return;
    const t = setTimeout(() => void loadList(p), 700);
    return () => clearTimeout(t);
  });

  // Diff the selected revision → current text (so restore visibly undoes what's
  // shown). null selection or an identical revision shows nothing.
  const diff = $derived(
    selectedContent === null ? [] : diffLines(selectedContent, content),
  );
  const stats = $derived(diffStats(diff));
  const isCurrent = $derived(selectedContent !== null && selectedContent === content);

  function originLabel(origin: RevisionMeta['origin']): string | null {
    if (origin === 'restore') return 'restored';
    if (origin === 'proposal') return 'AI';
    return null;
  }

  async function restore(): Promise<void> {
    if (!activeFilePath || selectedTs === null || !onRestore) return;
    await onRestore(activeFilePath, selectedTs);
    // App's write reloads the editor; refresh the list so the restore's own new
    // revision shows up.
    await loadList(activeFilePath);
  }
</script>

<div class="history-panel">
  {#if !activeFilePath}
    <p class="empty">No active note.</p>
  {:else if revisions.length === 0}
    <p class="empty">No history yet — your edits are saved here as you go.</p>
  {:else}
    <ul class="timeline">
      {#each revisions as rev (rev.ts)}
        {@const label = originLabel(rev.origin)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class:selected={rev.ts === selectedTs}
          onclick={() => activeFilePath && select(activeFilePath, rev.ts)}
        >
          <span class="when">{formatRelativeTime(rev.ts, now)}</span>
          {#if rev.label}<span class="tag">{rev.label}</span>{/if}
          {#if label}<span class="origin">{label}</span>{/if}
        </li>
      {/each}
    </ul>

    {#if selectedTs !== null}
      <div class="diff-head">
        {#if isCurrent}
          <span class="same">This is the current version.</span>
        {:else}
          <span class="counts"><span class="add">+{stats.added}</span> <span class="rem">−{stats.removed}</span></span>
          <button class="restore" type="button" onclick={restore} disabled={!onRestore}>Restore</button>
        {/if}
      </div>
      {#if !isCurrent}
        <div class="diff">
          {#each diff as line, i (i)}
            <div class="line {line.type}"><span class="gutter">{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}</span>{line.text || ' '}</div>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .history-panel { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .empty { color: var(--text-muted); font-size: 13px; padding: 12px; }

  .timeline { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 0 0 auto; max-height: 45%; }
  .timeline li {
    display: flex; align-items: baseline; gap: 8px;
    padding: 6px 12px; cursor: pointer; border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .timeline li:hover { background: var(--bg-button); }
  .timeline li.selected { background: color-mix(in oklch, var(--accent) 14%, transparent); }
  .when { color: var(--text); }
  .tag {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px;
    color: var(--accent); border: 1px solid color-mix(in oklch, var(--accent) 40%, var(--border));
    border-radius: 3px; padding: 0 4px;
  }
  .origin { font-size: 10px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.3px; }

  .diff-head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 8px 12px; border-bottom: 1px solid var(--border);
  }
  .counts { font-size: 12px; }
  .add { color: color-mix(in oklch, green 60%, var(--text)); }
  .rem { color: color-mix(in oklch, var(--text-muted) 80%, red); }
  .same { color: var(--text-muted); font-size: 12px; }
  .restore {
    font-family: var(--font-sans); font-size: 12px; color: var(--accent);
    background: none; border: 1px solid color-mix(in oklch, var(--accent) 40%, var(--border));
    padding: 3px 12px; border-radius: 4px; cursor: pointer;
  }
  .restore:hover:not(:disabled) { background: color-mix(in oklch, var(--accent) 10%, transparent); }

  .diff { overflow: auto; flex: 1 1 auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; padding: 4px 0; }
  .line { display: flex; gap: 6px; padding: 0 12px; white-space: pre-wrap; word-break: break-word; }
  .line .gutter { flex: 0 0 auto; width: 0.9em; text-align: center; color: var(--text-faint); user-select: none; }
  .line.add { background: color-mix(in oklch, green 12%, transparent); }
  .line.remove { background: color-mix(in oklch, red 10%, transparent); color: var(--text-muted); }
</style>
