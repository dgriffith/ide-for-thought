<!--
  View B (#847) — a note's link neighborhood as an interactive force graph.

  Fetches the depth-N neighborhood (#846) for `relativePath`, renders it through
  the shared GraphCanvas (#844) with a cose force layout, and wires the shared
  click model: activating a note opens it, a source opens the source viewer.
  Notes/sources are styled distinctly (GraphCanvas stylesheet), the root is
  highlighted, missing targets muted, and edges are colored by link type with a
  legend. A depth control reshapes the walk; a selected node can be expanded one
  hop on demand (explicit, never plain single-click). Truncation shows "+N more".
-->
<script lang="ts">
  import GraphCanvas from './GraphCanvas.svelte';
  import { api } from '../ipc/client';
  import { getEditorStore } from '../stores/editor.svelte';
  import type { LayoutOptions, ElementDefinition } from 'cytoscape';
  import type { NeighborhoodResult, NeighborhoodNode } from '../../../shared/types';

  interface Props {
    relativePath: string;
    depth: number;
    /** Active note's revision — re-fetch when its links change. */
    revision?: number;
    onOpenNote: (relativePath: string) => void;
  }

  let { relativePath, depth, revision = 0, onOpenNote }: Props = $props();

  const editor = getEditorStore();

  let result = $state<NeighborhoodResult>({ nodes: [], edges: [], truncated: false });
  // Nodes pulled in via expand-on-demand, merged over the base fetch.
  let extra = $state<{ nodes: NeighborhoodResult['nodes']; edges: NeighborhoodResult['edges'] }>({ nodes: [], edges: [] });
  let selected = $state<NeighborhoodNode | null>(null);
  let loading = $state(false);
  let graph = $state<GraphCanvas>();

  const layout: LayoutOptions = {
    name: 'cose',
    animate: false,
    padding: 24,
    nodeRepulsion: () => 8000,
    idealEdgeLength: () => 90,
  };

  // Re-fetch when the note, depth, or its revision changes; expansions reset.
  $effect(() => {
    const path = relativePath;
    const d = depth;
    void revision;
    loading = true;
    extra = { nodes: [], edges: [] };
    selected = null;
    void api.links.neighborhood(path, { depth: d }).then((r) => {
      // Ignore a stale response if the inputs changed mid-flight.
      if (path === relativePath && d === depth) { result = r; loading = false; }
    });
  });

  // Merge base + expanded, deduped by id/edge-key, into Cytoscape elements.
  const elements = $derived.by(() => {
    const nodeById = new Map<string, NeighborhoodNode>();
    for (const n of [...result.nodes, ...extra.nodes]) nodeById.set(n.id, n);
    const edgeKeys = new Set<string>();
    const edges: ElementDefinition[] = [];
    for (const e of [...result.edges, ...extra.edges]) {
      const key = `${e.source} ${e.target} ${e.linkType}`;
      if (edgeKeys.has(key)) continue;
      // Drop an edge whose endpoints aren't both present.
      if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
      edgeKeys.add(key);
      edges.push({ data: { id: `edge:${key}`, source: e.source, target: e.target, linkType: e.linkType, linkColor: e.linkColor } });
    }
    const nodes: ElementDefinition[] = [...nodeById.values()].map((n) => ({
      data: {
        id: n.id,
        label: n.label,
        kind: n.kind,
        root: n.id === relativePath ? true : undefined,
        missing: n.exists ? undefined : true,
      },
    }));
    return { nodes, edges };
  });

  // Legend: the distinct link types present, with their colors.
  const legend = $derived.by(() => {
    const seen = new Map<string, { label: string; color: string }>();
    for (const e of [...result.edges, ...extra.edges]) {
      if (!seen.has(e.linkType)) seen.set(e.linkType, { label: e.linkLabel, color: e.linkColor });
    }
    return [...seen.entries()].map(([type, v]) => ({ type, ...v }));
  });

  function navigate(data: Record<string, unknown>): void {
    const id = String(data.id);
    if (data.kind === 'source') editor.openSource(id.replace(/^source:/, ''));
    else onOpenNote(id);
  }

  function onSelect(data: Record<string, unknown> | null): void {
    if (!data) { selected = null; return; }
    selected = { id: String(data.id), kind: data.kind === 'source' ? 'source' : 'note', label: String(data.label ?? data.id), exists: !data.missing };
  }

  async function expandSelected(): Promise<void> {
    if (!selected || selected.kind !== 'note') return;
    const hop = await api.links.expandNode(selected.id);
    extra = { nodes: [...extra.nodes, ...hop.nodes], edges: [...extra.edges, ...hop.edges] };
  }

  function changeDepth(next: number): void {
    editor.setGraphDepth(relativePath, next);
  }

  export function updateTheme(): void { graph?.updateTheme(); }
</script>

<div class="neighborhood-graph">
  <div class="toolbar">
    <span class="depth-control">
      Depth
      <button class="step" disabled={depth <= 1} onclick={() => changeDepth(depth - 1)} title="Shallower">−</button>
      <span class="depth-val">{depth}</span>
      <button class="step" disabled={depth >= 5} onclick={() => changeDepth(depth + 1)} title="Deeper">+</button>
    </span>

    {#if selected && selected.kind === 'note'}
      <button class="expand-btn" onclick={expandSelected} title="Pull in this node's links">
        Expand “{selected.label}”
      </button>
    {/if}

    {#if result.truncated}
      <span class="truncation" title="The neighborhood was capped">+ more (capped)</span>
    {/if}

    <span class="spacer"></span>

    {#if legend.length > 0}
      <span class="legend">
        {#each legend as item (item.type)}
          <span class="legend-item" title={item.label}>
            <span class="swatch" style:background={item.color}></span>{item.label}
          </span>
        {/each}
      </span>
    {/if}
  </div>

  <div class="canvas-wrap">
    {#if loading && result.nodes.length === 0}
      <div class="status">Loading neighborhood…</div>
    {:else if result.nodes.length <= 1 && extra.nodes.length === 0}
      <div class="status">No links to or from this note yet.</div>
    {/if}
    <GraphCanvas bind:this={graph} {elements} {layout} {navigate} {onSelect} />
  </div>
</div>

<style>
  .neighborhood-graph {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-inset);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-muted);
    flex-wrap: wrap;
  }
  .spacer { flex: 1; }
  .depth-control { display: inline-flex; align-items: center; gap: 4px; }
  .depth-val { min-width: 12px; text-align: center; color: var(--text); }
  .step, .expand-btn {
    border: 1px solid var(--border);
    background: var(--bg-button);
    color: var(--text);
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    padding: 1px 8px;
    line-height: 1.4;
  }
  .step:disabled { opacity: 0.4; cursor: default; }
  .step:hover:not(:disabled), .expand-btn:hover { border-color: var(--accent); }
  .truncation { color: var(--rust, var(--accent)); }
  .legend { display: inline-flex; gap: 10px; flex-wrap: wrap; }
  .legend-item { display: inline-flex; align-items: center; gap: 4px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .canvas-wrap { position: relative; flex: 1; min-height: 0; }
  .status {
    position: absolute;
    top: 12px;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 12px;
    color: var(--text-muted);
    pointer-events: none;
    z-index: 1;
  }
</style>
