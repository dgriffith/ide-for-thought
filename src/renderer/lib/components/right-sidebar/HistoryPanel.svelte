<script lang="ts">
  // Local per-note history (#1158, PR 2) — IntelliJ-style "Local History" for
  // the active note: a timeline of saved revisions, a diff of the selected one
  // against the current text, and one-click restore.
  //
  // The revision list, the `history:changed` subscription, the reads and the
  // three mutations live in the history store (#1834); this owns only view
  // state — which revision is selected, its content, the diff, and the context
  // menu.
  import { getHistoryStore } from '../../stores/history.svelte';
  import { clampMenuToViewport } from '../../utils/menuClamp';
  import { installDismissOnClickOutside } from '../../dismiss-menu';
  import { formatDateTime } from '../../../../shared/format-datetime';
  import { diffLines, diffStats } from '../../history/line-diff';
  import { describeRevisionCause, type RevisionMeta } from '../../../../shared/history';

  interface Props {
    activeFilePath: string | null;
    /** Current editor content — the diff's "after". */
    content: string;
  }

  let { activeFilePath, content }: Props = $props();

  const history = getHistoryStore();
  const revisions = $derived(history.revisions);

  let selectedTs = $state<number | null>(null);
  let selectedContent = $state<string | null>(null);
  let now = $state(Date.now());
  let menu = $state<{ x: number; y: number; rev: RevisionMeta } | null>(null);
  let menuEl = $state<HTMLDivElement | undefined>();

  $effect(() => {
    if (!menu || !menuEl) return;
    const next = clampMenuToViewport(menu.x, menu.y, menuEl);
    if (next.x !== menu.x || next.y !== menu.y) menu = { ...menu, ...next };
  });

  function openMenu(e: MouseEvent, rev: RevisionMeta): void {
    e.preventDefault();
    menu = { x: e.clientX, y: e.clientY, rev };
    installDismissOnClickOutside(() => { menu = null; });
  }

  async function label(rev: RevisionMeta): Promise<void> {
    menu = null;
    if (!activeFilePath) return;
    await history.label(activeFilePath, rev.ts, rev.label ?? null);
  }

  async function removeLabel(rev: RevisionMeta): Promise<void> {
    menu = null;
    if (!activeFilePath) return;
    await history.removeLabel(activeFilePath, rev.ts);
  }

  async function select(relativePath: string, ts: number): Promise<void> {
    selectedTs = ts;
    selectedContent = await history.readRevision(relativePath, ts);
  }

  // Point the store at the open note; it refetches on change and on every
  // `history:changed` event for this note, so there is nothing to poll.
  $effect(() => {
    history.watch(activeFilePath);
  });

  // Drop a selection the list no longer contains (the note changed, or the
  // revision was pruned) so the diff can't show text that isn't there.
  $effect(() => {
    const list = history.revisions;
    void history.revision;
    if (selectedTs !== null && !list.some((r) => r.ts === selectedTs)) {
      selectedTs = null;
      selectedContent = null;
    }
    now = Date.now();
  });

  // Diff the selected revision → current text (so restore visibly undoes what's
  // shown). null selection or an identical revision shows nothing. Note
  // `isIdentical` is about CONTENT, not recency — an older revision the note was
  // later restored (or edited back) to matches too, which is why the panel says
  // "Contents are identical" rather than "this is the current version".
  const diff = $derived(
    selectedContent === null ? [] : diffLines(selectedContent, content),
  );
  const stats = $derived(diffStats(diff));
  const isIdentical = $derived(selectedContent !== null && selectedContent === content);

  async function restore(): Promise<void> {
    if (!activeFilePath || selectedTs === null) return;
    // The write reloads the editor and fires `history:changed`, which refreshes
    // the list — including the restore's own new revision.
    await history.restore(activeFilePath, selectedTs);
  }
</script>

<div class="history-panel">
  {#if !activeFilePath}
    <p class="empty">No active note.</p>
  {:else if history.error}
    <!-- A damaged index reads as "no history yet" if we stay quiet about it,
         which is how a note's whole past can look like it was never there. -->
    <p class="empty">
      This note's history couldn't be read. Its record in
      <code>.minerva/history</code> may be damaged.
      <span class="detail">{history.error}</span>
    </p>
  {:else if revisions.length === 0}
    <p class="empty">No history yet — your edits are saved here as you go.</p>
  {:else}
    <ul class="timeline">
      {#each revisions as rev (rev.ts)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class:selected={rev.ts === selectedTs}
          onclick={() => activeFilePath && select(activeFilePath, rev.ts)}
          oncontextmenu={(e) => openMenu(e, rev)}
        >
          <span class="when">{formatDateTime(rev.ts, now)}</span>
          <!-- The name chip sits beside the timestamp (row 1, column 2); the
               cause spans the row below it. -->
          {#if rev.label}<span class="tag">{rev.label}</span>{/if}
          <span class="cause" class:ai={rev.origin === 'proposal'}>{describeRevisionCause(rev)}</span>
        </li>
      {/each}
    </ul>

    {#if selectedTs !== null}
      <div class="diff-head">
        {#if isIdentical}
          <span class="same">Contents are identical.</span>
        {:else}
          <span class="counts"><span class="add">+{stats.added}</span> <span class="rem">−{stats.removed}</span></span>
          <button class="restore" type="button" onclick={restore}>Restore</button>
        {/if}
      </div>
      {#if !isIdentical}
        <div class="diff">
          {#each diff as line, i (i)}
            <div class="line {line.type}"><span class="gutter">{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}</span>{line.text || ' '}</div>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</div>

{#if menu}
  <div class="context-menu" bind:this={menuEl} style:left="{menu.x}px" style:top="{menu.y}px">
    <button onclick={() => label(menu!.rev)}>
      {menu.rev.label ? 'Rename Label…' : 'Label Version…'}
    </button>
    {#if menu.rev.label}
      <button onclick={() => removeLabel(menu!.rev)}>Remove Label</button>
    {/if}
  </div>
{/if}

<style>
  .history-panel { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .empty { color: var(--text-muted); font-size: 13px; padding: 12px; line-height: 1.5; }
  .empty code { font-family: var(--font-mono); font-size: 11px; }
  .empty .detail { display: block; margin-top: 6px; color: var(--text-faint); font-size: 11px; }

  .timeline { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 0 0 auto; max-height: 45%; }
  .timeline li {
    display: grid; grid-template-columns: 1fr auto; align-items: baseline;
    column-gap: 8px;
    padding: 6px 12px; cursor: pointer; border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .timeline li:hover { background: var(--bg-button); }
  .timeline li.selected { background: color-mix(in oklch, var(--accent) 14%, transparent); }
  .when { color: var(--text); }
  /* What produced this version — the IntelliJ Local History "action" column. */
  .cause {
    grid-column: 1 / -1;
    font-size: 11px; color: var(--text-muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cause.ai { color: color-mix(in oklch, var(--accent) 70%, var(--text-muted)); }
  .tag {
    justify-self: end; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px;
    color: var(--accent); border: 1px solid color-mix(in oklch, var(--accent) 40%, var(--border));
    border-radius: 3px; padding: 0 4px;
  }

  .context-menu {
    position: fixed;
    z-index: var(--z-popover);
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 140px;
  }
  .context-menu button {
    display: block; width: 100%; padding: 6px 12px;
    border: none; background: none; color: var(--text);
    font-size: 12px; cursor: pointer; text-align: left;
  }
  .context-menu button:hover { background: var(--bg-button); }

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
