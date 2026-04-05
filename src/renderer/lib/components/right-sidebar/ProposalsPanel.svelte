<script lang="ts">
  import { api } from '../../ipc/client';
  import { onMount } from 'svelte';

  interface Proposal {
    uri: string;
    status: string;
    operationType: string;
    note: string;
    proposedBy: string;
    proposedAt: string;
    turtleDiff: string;
  }

  interface Props {
    revision: number;
  }

  let { revision }: Props = $props();

  let proposals = $state<Proposal[]>([]);
  let selectedUri = $state<string | null>(null);
  let processing = $state(false);

  async function refresh() {
    const result = await api.proposals.list('pending');
    proposals = result as Proposal[];
  }

  onMount(() => { refresh(); });

  $effect(() => {
    revision;
    refresh();
  });

  async function handleApprove(uri: string) {
    processing = true;
    await api.proposals.approve(uri);
    selectedUri = null;
    await refresh();
    processing = false;
  }

  async function handleReject(uri: string) {
    processing = true;
    await api.proposals.reject(uri);
    selectedUri = null;
    await refresh();
    processing = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!selectedUri) return;
    if (e.key === 'y') { e.preventDefault(); handleApprove(selectedUri); }
    if (e.key === 'n') { e.preventDefault(); handleReject(selectedUri); }
    if (e.key === 's' || e.key === 'Escape') { e.preventDefault(); selectedUri = null; }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="proposals-panel" onkeydown={handleKeydown} tabindex="-1">
  {#if proposals.length === 0}
    <p class="empty">No pending proposals</p>
  {:else}
    <div class="proposal-list">
      {#each proposals as p}
        <button
          class="proposal-item"
          class:selected={selectedUri === p.uri}
          onclick={() => selectedUri = selectedUri === p.uri ? null : p.uri}
        >
          <span class="proposal-type">{p.operationType.replace(/_/g, ' ')}</span>
          <span class="proposal-note">{p.note}</span>
          <span class="proposal-by">{p.proposedBy}</span>
        </button>

        {#if selectedUri === p.uri}
          <div class="proposal-detail">
            <div class="diff-view">
              <pre>{p.turtleDiff}</pre>
            </div>
            <div class="proposal-actions">
              <button class="action-btn approve" onclick={() => handleApprove(p.uri)} disabled={processing}>
                Approve (y)
              </button>
              <button class="action-btn reject" onclick={() => handleReject(p.uri)} disabled={processing}>
                Reject (n)
              </button>
              <button class="action-btn skip" onclick={() => selectedUri = null}>
                Skip (s)
              </button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .proposals-panel {
    padding: 8px;
    overflow-y: auto;
    flex: 1;
    outline: none;
  }

  .empty {
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
    padding: 16px 0;
  }

  .proposal-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .proposal-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: none;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  .proposal-item:hover { background: var(--bg-button); }
  .proposal-item.selected { border-color: var(--accent); background: var(--bg-button); }

  .proposal-type {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
  }

  .proposal-note {
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .proposal-by {
    font-size: 10px;
    color: var(--text-muted);
  }

  .proposal-detail {
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .diff-view {
    padding: 8px;
    background: var(--bg-code, var(--bg-titlebar));
    overflow-x: auto;
    max-height: 150px;
    overflow-y: auto;
  }

  .diff-view pre {
    margin: 0;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    color: var(--text);
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .proposal-actions {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--border);
  }

  .action-btn {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
  }

  .action-btn:hover { background: var(--bg-button-hover); }
  .action-btn:disabled { opacity: 0.4; cursor: default; }
  .action-btn.approve { border-color: var(--accent); }
</style>
