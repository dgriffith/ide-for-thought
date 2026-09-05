<script lang="ts">
  import { api } from '../ipc/client';
  import Icon from './Icon.svelte';
  import { QUEUE_VIEWS, type QueueView } from '../sources/reading-queue';

  interface Props {
    activeView: QueueView | null;
    /** Toggle logic (clicking the active row deselects back to "All sources")
     *  stays with the caller, since it also has to reset collection-selection
     *  state that lives outside this component. */
    onSelect: (view: QueueView) => void;
  }

  let { activeView, onSelect }: Props = $props();

  /** Counts shown next to each queue row. Refreshed on mount and whenever the
   *  host calls refreshCounts() (e.g. after a source list refresh). */
  let queueCounts = $state<Record<QueueView, number>>({
    unread: 0, reading: 0, dueThisWeek: 0, recentlyFinished: 0,
  });

  /** Section collapsed-state. Default is expanded; the section sits below
   *  Collections and is the user's preference to fold out of the way once
   *  collections become the primary view. */
  const QUEUE_EXPANDED_KEY = 'minerva.sources.queueExpanded';
  let queueExpanded = $state<boolean>(loadQueueExpanded());
  function loadQueueExpanded(): boolean {
    try {
      const raw = localStorage.getItem(QUEUE_EXPANDED_KEY);
      return raw === null ? true : raw === 'true';
    } catch { return true; }
  }
  function toggleQueueExpanded(): void {
    queueExpanded = !queueExpanded;
    try { localStorage.setItem(QUEUE_EXPANDED_KEY, String(queueExpanded)); } catch { /* ok */ }
  }

  export async function refreshCounts(): Promise<void> {
    const entries = await Promise.all(
      QUEUE_VIEWS.map(async (v) => [v.id, (await api.sources.queueMembers(v.id)).length] as const),
    );
    const next: Record<QueueView, number> = { unread: 0, reading: 0, dueThisWeek: 0, recentlyFinished: 0 };
    for (const [id, count] of entries) next[id] = count;
    queueCounts = next;
  }

  $effect(() => {
    void refreshCounts();
  });
</script>

<div class="queue-section">
  <button
    class="queue-header"
    onclick={toggleQueueExpanded}
    aria-expanded={queueExpanded}
    title={queueExpanded ? 'Collapse reading queue' : 'Expand reading queue'}
  >
    <Icon name={queueExpanded ? 'chevronDown' : 'chevronRight'} size={11} color="var(--text-faint)" />
    <span class="section-eyebrow queue-eyebrow">READING QUEUE</span>
  </button>
  {#if queueExpanded}
    {#each QUEUE_VIEWS as v (v.id)}
      <button
        class="coll-row queue-row"
        class:active={activeView === v.id}
        onclick={() => onSelect(v.id)}
        title={`Show ${v.label.toLowerCase()}`}
      >
        <span class="chevron-spacer"></span>
        <span class="coll-name">{v.label}</span>
        <span class="coll-count">{queueCounts[v.id]}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  /* Reading-queue section sits BELOW Collections, with a collapsible header
     so users who never touch the queue can fold it away. Same row shape as
     the collection tree (.coll-row, shared visually with CollectionsTree.svelte
     but not a shared class since Svelte scopes styles per-component); no "+"
     button because the views are built-in. */
  .queue-section {
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
    padding-bottom: 4px;
  }
  .section-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    letter-spacing: 0.06em;
    padding: 10px 14px 4px;
  }
  .queue-header {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 10px 14px 4px 8px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .queue-header:hover .queue-eyebrow {
    color: var(--text-muted);
  }
  .queue-eyebrow {
    padding: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    letter-spacing: 0.06em;
  }
  .coll-row {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 4px 12px 4px 8px;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .coll-row:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
  }
  .coll-row.active {
    background: color-mix(in oklch, var(--accent) 12%, transparent);
    border-left-color: var(--accent);
    color: var(--accent);
  }
  .chevron-spacer {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .coll-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .coll-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .coll-row.active .coll-count { color: var(--accent); }
  /* .queue-row re-uses the .coll-row look — no rules of its own. */
</style>
