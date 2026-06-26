<!--
  View A (#845) — the active note's heading tree as an interactive graph.

  Same data as the Outline panel (`extractHeadings`), laid out spatially via the
  shared GraphCanvas (#844) and clickable: activating a node scrolls the editor
  to that heading (`onScrollToLine`). Re-derives live as the buffer changes,
  since `content` is reactive.
-->
<script lang="ts">
  import GraphCanvas from '../GraphCanvas.svelte';
  import { extractHeadings } from '../../markdown/headings';
  import { buildHeadingElements } from '../../graph/heading-graph';
  import { getGraphSettings } from '../../stores/graph-settings.svelte';
  import type { LayoutOptions } from 'cytoscape';

  interface Props {
    content: string;
    /** Note display name → the synthetic root label. */
    title?: string;
    onScrollToLine: (line: number) => void;
  }

  let { content, title = 'Note', onScrollToLine }: Props = $props();

  const settings = getGraphSettings();

  const headings = $derived(extractHeadings(content));
  const elements = $derived(buildHeadingElements(headings, title));

  let graph = $state<GraphCanvas>();

  // Tidy top-down tree; the root sits above its headings.
  const layout: LayoutOptions = {
    name: 'breadthfirst',
    directed: true,
    padding: 16,
    spacingFactor: 1.15,
  };

  function navigate(data: Record<string, unknown>): void {
    if (typeof data.line === 'number') onScrollToLine(data.line);
  }

  /** Forwarded from RightSidebar on theme switch. */
  export function updateTheme(): void {
    graph?.updateTheme();
  }
</script>

<div class="heading-graph-panel">
  {#if headings.length === 0}
    <div class="empty">No headings to map</div>
  {:else}
    <div class="hg-toolbar">
      <button
        class="hg-toggle"
        class:on={settings.autoNavigate}
        onclick={() => settings.toggleAutoNavigate()}
        title={settings.autoNavigate
          ? 'Click scrolls to the heading. Switch to: click selects'
          : 'Click selects (double-click scrolls). Switch to: click scrolls'}
      >
        {settings.autoNavigate ? 'Click: open' : 'Click: select'}
      </button>
    </div>
    <GraphCanvas bind:this={graph} {elements} {layout} {navigate} autoNavigate={settings.autoNavigate} />
  {/if}
</div>

<style>
  .heading-graph-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .empty {
    padding: 12px;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
  .hg-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .hg-toggle {
    border: 1px solid var(--border);
    background: var(--bg-button);
    color: var(--text-muted);
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    padding: 1px 6px;
  }
  .hg-toggle:hover { border-color: var(--accent); }
  .hg-toggle.on { color: var(--bg); background: var(--accent); border-color: var(--accent); }
</style>
