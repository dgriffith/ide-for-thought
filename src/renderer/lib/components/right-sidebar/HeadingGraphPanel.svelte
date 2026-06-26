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
  import type { LayoutOptions } from 'cytoscape';

  interface Props {
    content: string;
    /** Note display name → the synthetic root label. */
    title?: string;
    onScrollToLine: (line: number) => void;
  }

  let { content, title = 'Note', onScrollToLine }: Props = $props();

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
    <GraphCanvas bind:this={graph} {elements} {layout} {navigate} />
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
</style>
