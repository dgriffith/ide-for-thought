<script lang="ts">
  import { api } from '../../ipc/client';
  import { getReviewStore } from '../../stores/review.svelte';
  import { onMount } from 'svelte';
  import Ribbon from './Ribbon.svelte';
  import type { InspectionFix } from '../../../../shared/types';

  const review = getReviewStore();

  interface Inspection {
    id: string;
    type: string;
    severity: string;
    nodeUri: string;
    nodeLabel: string;
    message: string;
    suggestedAction?: string;
    fix?: InspectionFix;
    notePath?: string;
  }

  interface Props {
    revision: number;
    /** The active note's relative path. The panel scopes to inspections anchored
     *  to this note (#1446) — this is a note-context sidebar, not a project view. */
    activeFilePath: string | null;
    onOpenConversation?: (message: string) => void;
    /** Apply an inspection's deterministic quick-fix (#1446). When present on a
     *  row, it's the primary action — conversation is only the fallback for
     *  inspections that carry no fix. Returns a promise so the panel can re-run
     *  the checks once the fix has applied and clear the fixed row. */
    onApplyFix?: (fix: InspectionFix) => void | Promise<void>;
  }

  let { revision, activeFilePath, onOpenConversation, onApplyFix }: Props = $props();

  let inspections = $state<Inspection[]>([]);
  let loading = $state(false);
  let search = $state('');
  let sortId = $state<'severity' | 'type'>('severity');
  // Scope (#1446): 'note' (default) keeps the note-context filter; 'project'
  // shows every inspection — the only way source-scoped inspections (unread
  // sources, aged stubs, dupes) surface, since they aren't anchored to a note.
  let scope = $state<'note' | 'project'>('note');

  async function refresh() {
    loading = true;
    inspections = await api.graph.inspections();
    loading = false;
  }

  async function runNow() {
    loading = true;
    inspections = await review.runInspections();
    loading = false;
  }

  onMount(() => { void refresh(); });

  $effect(() => { revision; void refresh(); });

  // Scope to the active note (#1446): in 'note' scope the panel lives in the
  // note-context right sidebar, so it shows only inspections anchored to the
  // open note (those without a notePath — source dupes/metadata, standalone
  // claim components — aren't "on" a note). 'project' scope shows everything.
  const scoped = $derived(
    scope === 'project'
      ? inspections
      : (activeFilePath ? inspections.filter(i => i.notePath === activeFilePath) : []),
  );

  const filtered = $derived(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(i =>
      i.nodeLabel.toLowerCase().includes(q) ||
      i.message.toLowerCase().includes(q) ||
      i.type.toLowerCase().includes(q)
    );
  });
  const concerns = $derived(filtered().filter(i => i.severity === 'concern'));
  const warnings = $derived(filtered().filter(i => i.severity === 'warning'));
  const infos = $derived(filtered().filter(i => i.severity === 'info'));
  // In "by type" mode we show one group per distinct check type. Keeps
  // the severity icon per row so the triage signal isn't lost.
  const byType = $derived(() => {
    const map = new Map<string, Inspection[]>();
    for (const i of filtered()) {
      const list = map.get(i.type) ?? [];
      list.push(i);
      map.set(i.type, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  function severityIcon(severity: string): string {
    if (severity === 'concern') return '\u25C9'; // ◉
    if (severity === 'warning') return '\u25CB'; // ○
    return '\u00B7'; // ·
  }

  async function handleClick(inspection: Inspection) {
    // Deterministic-first (#1446): a fixable inspection applies its fix; only
    // inspections with no fix fall back to opening a conversation.
    if (inspection.fix) {
      // Re-run the checks after the fix applies so the fixed row clears — the
      // main-side results are cached and aren't recomputed on a graph write.
      await onApplyFix?.(inspection.fix);
      void runNow();
      return;
    }
    if (onOpenConversation) {
      onOpenConversation(`I'd like to discuss this inspection: "${inspection.message}". ${inspection.suggestedAction ?? ''}`);
    }
  }
</script>

<div class="inspections-panel">
  <Ribbon
    {search}
    onSearch={(q: string) => { search = q; }}
    searchPlaceholder="Find inspection…"
    sortOptions={[
      { id: 'severity', label: 'By severity' },
      { id: 'type', label: 'By type' },
    ]}
    {sortId}
    onSort={(id: string) => { sortId = id as 'severity' | 'type'; }}
  />
  <div class="panel-header">
    <div class="scope-toggle" role="group" aria-label="Inspection scope">
      <button class:active={scope === 'note'} onclick={() => { scope = 'note'; }} title="Inspections on the current note">This note</button>
      <button class:active={scope === 'project'} onclick={() => { scope = 'project'; }} title="Every inspection in the thoughtbase, including source-level ones">Project</button>
    </div>
    <button class="refresh-btn" onclick={runNow} disabled={loading} title="Re-run health checks">
      {loading ? '...' : 'Run'}
    </button>
  </div>

  <!-- One row per inspection. A fixable inspection (#1446) shows its fix label
       as a trailing pill and the whole row applies the fix; others keep the
       conversation fallback. The row is a single button, so the pill is a
       non-interactive span (no nested interactive element). -->
  {#snippet row(insp: Inspection)}
    <button class="inspection-item {insp.severity}" onclick={() => void handleClick(insp)} title={insp.fix ? insp.fix.label : (insp.suggestedAction ?? '')}>
      <span class="insp-icon">{severityIcon(insp.severity)}</span>
      <div class="insp-body">
        <span class="insp-label">{insp.nodeLabel}</span>
        <span class="insp-message">{insp.message}</span>
      </div>
      {#if insp.fix}<span class="fix-hint">{insp.fix.label}</span>{/if}
    </button>
  {/snippet}

  {#if filtered().length === 0}
    <p class="empty">{loading ? 'Checking...' : (scoped.length === 0 ? (scope === 'project' ? 'No inspections' : 'No inspections for this note') : 'No matches')}</p>
  {:else if sortId === 'type'}
    <div class="inspection-list">
      {#each byType() as [typeName, items]}
        <div class="severity-group">
          <span class="group-label">{typeName.replace(/_/g, ' ')} ({items.length})</span>
          {#each items as insp}
            {@render row(insp)}
          {/each}
        </div>
      {/each}
    </div>
  {:else}
    <div class="inspection-list">
      {#if concerns.length > 0}
        <div class="severity-group">
          <span class="group-label concern">Concerns ({concerns.length})</span>
          {#each concerns as insp}
            {@render row(insp)}
          {/each}
        </div>
      {/if}
      {#if warnings.length > 0}
        <div class="severity-group">
          <span class="group-label warning">Warnings ({warnings.length})</span>
          {#each warnings as insp}
            {@render row(insp)}
          {/each}
        </div>
      {/if}
      {#if infos.length > 0}
        <div class="severity-group">
          <span class="group-label info">Info ({infos.length})</span>
          {#each infos as insp}
            {@render row(insp)}
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

  /* Segmented This note / Project scope switch (#1446). */
  .scope-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }
  .scope-toggle button {
    padding: 2px 8px;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
  }
  .scope-toggle button:first-child { border-right: 1px solid var(--border); }
  .scope-toggle button:hover { color: var(--text); }
  .scope-toggle button.active {
    background: var(--bg-button);
    color: var(--text);
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

  /* Deterministic-fix affordance (#1446): a compact pill naming the action the
     row applies (e.g. "Create Note"). Non-interactive — the row button owns the
     click; it brightens with the row on hover to read as the action label. */
  .fix-hint {
    flex-shrink: 0;
    align-self: center;
    margin-left: auto;
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .inspection-item:hover .fix-hint {
    color: var(--text);
    border-color: var(--accent);
  }
</style>
