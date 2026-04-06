<script lang="ts">
  import { api } from '../../ipc/client';
  import { onMount } from 'svelte';

  interface Inspection {
    id: string;
    type: string;
    severity: string;
    nodeUri: string;
    nodeLabel: string;
    message: string;
    suggestedAction?: string;
  }

  interface Props {
    revision: number;
    onOpenConversation?: (message: string) => void;
  }

  let { revision, onOpenConversation }: Props = $props();

  let inspections = $state<Inspection[]>([]);
  let loading = $state(false);

  async function refresh() {
    loading = true;
    inspections = await api.graph.inspections() as Inspection[];
    loading = false;
  }

  async function runNow() {
    loading = true;
    inspections = await api.graph.runInspections() as Inspection[];
    loading = false;
  }

  onMount(() => { refresh(); });

  $effect(() => { revision; refresh(); });

  const concerns = $derived(inspections.filter(i => i.severity === 'concern'));
  const warnings = $derived(inspections.filter(i => i.severity === 'warning'));
  const infos = $derived(inspections.filter(i => i.severity === 'info'));

  function severityIcon(severity: string): string {
    if (severity === 'concern') return '\u25C9'; // ◉
    if (severity === 'warning') return '\u25CB'; // ○
    return '\u00B7'; // ·
  }

  function handleClick(inspection: Inspection) {
    if (onOpenConversation) {
      onOpenConversation(`I'd like to discuss this inspection: "${inspection.message}". ${inspection.suggestedAction ?? ''}`);
    }
  }
</script>

<div class="inspections-panel">
  <div class="panel-header">
    <span class="count">
      {inspections.length} inspection{inspections.length !== 1 ? 's' : ''}
    </span>
    <button class="refresh-btn" onclick={runNow} disabled={loading} title="Re-run health checks">
      {loading ? '...' : 'Run'}
    </button>
  </div>

  {#if inspections.length === 0}
    <p class="empty">{loading ? 'Checking...' : 'No inspections'}</p>
  {:else}
    <div class="inspection-list">
      {#if concerns.length > 0}
        <div class="severity-group">
          <span class="group-label concern">Concerns ({concerns.length})</span>
          {#each concerns as insp}
            <button class="inspection-item concern" onclick={() => handleClick(insp)} title={insp.suggestedAction ?? ''}>
              <span class="insp-icon">{severityIcon('concern')}</span>
              <div class="insp-body">
                <span class="insp-label">{insp.nodeLabel}</span>
                <span class="insp-message">{insp.message}</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}
      {#if warnings.length > 0}
        <div class="severity-group">
          <span class="group-label warning">Warnings ({warnings.length})</span>
          {#each warnings as insp}
            <button class="inspection-item warning" onclick={() => handleClick(insp)} title={insp.suggestedAction ?? ''}>
              <span class="insp-icon">{severityIcon('warning')}</span>
              <div class="insp-body">
                <span class="insp-label">{insp.nodeLabel}</span>
                <span class="insp-message">{insp.message}</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}
      {#if infos.length > 0}
        <div class="severity-group">
          <span class="group-label info">Info ({infos.length})</span>
          {#each infos as insp}
            <button class="inspection-item info" onclick={() => handleClick(insp)} title={insp.suggestedAction ?? ''}>
              <span class="insp-icon">{severityIcon('info')}</span>
              <div class="insp-body">
                <span class="insp-label">{insp.nodeLabel}</span>
                <span class="insp-message">{insp.message}</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .inspections-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .count {
    font-size: 11px;
    color: var(--text-muted);
  }

  .refresh-btn {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
  }

  .refresh-btn:hover:not(:disabled) { color: var(--text); background: var(--bg-button); }
  .refresh-btn:disabled { opacity: 0.4; }

  .empty {
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
    padding: 16px 0;
  }

  .inspection-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .severity-group {
    margin-bottom: 4px;
  }

  .group-label {
    display: block;
    padding: 4px 8px 2px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .group-label.concern { color: #fab387; }
  .group-label.warning { color: #f9e2af; }
  .group-label.info { color: var(--text-muted); }

  .inspection-item {
    display: flex;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    border-radius: 3px;
    margin: 0 4px;
  }

  .inspection-item:hover { background: var(--bg-button); }

  .insp-icon {
    flex-shrink: 0;
    width: 12px;
    font-size: 12px;
    line-height: 1.3;
  }

  .inspection-item.concern .insp-icon { color: #fab387; }
  .inspection-item.warning .insp-icon { color: #f9e2af; }
  .inspection-item.info .insp-icon { color: var(--text-muted); }

  .insp-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
  }

  .insp-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .insp-message {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
