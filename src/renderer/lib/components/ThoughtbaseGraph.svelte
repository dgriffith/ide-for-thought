<!--
  The whole thoughtbase as a graph (#2958, epic #2956). Main sends every note
  and edge once per graph change (`graph:whole`); the filters here narrow it
  (`whole-graph-filter.ts`) — kinds from the legend, folder, type, tag, orphans,
  and depth from a focused note, which is today's neighbourhood graph as a mode.

  Drawn by Cytoscape in its WebGL mode where the machine has WebGL (its canvas
  renderer otherwise), with positions from a force layout in a worker
  (`force-layout.worker.ts`) streamed in as it settles. Labels show once a node
  is drawn large enough to read. A list of the same notes and their
  connections sits behind **List**, for reaching all of it without the canvas.

  The filters, the focus and depth, and the camera are kept with the tab
  (`onState`).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Core, CytoscapeOptions, NodeSingular } from 'cytoscape';
  import { api } from '../ipc/client';
  import { loadCytoscape } from '../graph/load-cytoscape';
  import { readGraphTokens, buildGraphStyle, rgbGraphTokens } from '../graph/cytoscape-theme';
  import { filterWholeGraph, type ThoughtbaseGraphState } from '../graph/whole-graph-filter';
  import type { LayoutRequest, LayoutResponse } from '../graph/force-layout.worker';
  import type { WholeGraphResult } from '../../../shared/types';

  interface Props {
    state: ThoughtbaseGraphState;
    onState: (patch: Partial<ThoughtbaseGraphState>) => void;
    /** Bumped when the graph changes. */
    revision?: number;
    onOpenNote: (relativePath: string) => void;
    onOpenSource?: (sourceId: string) => void;
  }
  let { state: graphState, onState, revision = 0, onOpenNote, onOpenSource }: Props = $props();

  let data = $state<WholeGraphResult>({ nodes: [], edges: [], total: 0, truncated: false });
  let loaded = $state(false);
  let selected = $state<{ id: string; label: string; kind: string } | null>(null);
  let showList = $state(false);
  let container = $state<HTMLDivElement>();
  let cy: Core | null = null;
  let worker: Worker | null = null;
  let seq = 0;
  /** Where each node was last drawn, so a filter change keeps the picture steady. */
  const positions = new Map<string, { x: number; y: number }>();

  $effect(() => {
    void revision;
    const tags = graphState.showTags;
    void api.graph.whole({ tags }).then((g) => { if (tags === graphState.showTags) { data = g; loaded = true; } });
  });

  const shown = $derived(filterWholeGraph(data, graphState));
  const folders = $derived([...new Set(data.nodes.filter((n) => n.kind === 'note' || n.kind === 'term').map((n) => n.folder))].sort());
  const types = $derived([...new Set(data.nodes.map((n) => n.type).filter((t): t is string => t !== null))].sort());
  const tags = $derived([...new Set(data.nodes.flatMap((n) => n.tags))].sort());
  // The legend: the kinds drawn, from the one edge model (#2957).
  const legend = $derived.by(() => {
    const seen = new Map<string, { label: string; color: string }>();
    for (const e of data.edges) if (!seen.has(e.linkType)) seen.set(e.linkType, { label: e.linkLabel, color: e.linkColor });
    return [...seen.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.label.localeCompare(b.label));
  });
  const labelOf = $derived(new Map(data.nodes.map((n) => [n.id, n.label] as const)));
  /** Each shown node's connections, for the List — built once, not filtered per node. */
  const linksOf = $derived.by(() => {
    if (!showList) return new Map<string, typeof shown.edges>();
    const m = new Map<string, typeof shown.edges>();
    for (const e of shown.edges) for (const end of [e.source, e.target]) (m.get(end) ?? m.set(end, []).get(end)!).push(e);
    return m;
  });
  const focusLabel = $derived(graphState.focus ? labelOf.get(graphState.focus) ?? graphState.focus : null);

  /** WebGL2 where the machine has it (a GPU-less VM or remote desktop may not, #3011): `getContext` answers null then. */
  function hasWebGl(): boolean {
    return document.createElement('canvas').getContext('webgl2') !== null;
  }

  onMount(() => {
    let disposed = false;
    let cameraTimer: ReturnType<typeof setTimeout> | undefined;
    worker = new Worker(new URL('../graph/force-layout.worker.ts', import.meta.url), { type: 'module', name: 'graph-layout' });
    worker.onmessage = (e: MessageEvent<LayoutResponse>) => applyPositions(e.data);
    void (async () => {
      const cytoscape = await loadCytoscape();
      if (disposed || !container) return;
      const webgl = hasWebGl();
      // WebGL parses colours itself and doesn't read the theme's oklch: hand it rgb (#2958).
      const base = buildGraphStyle(webgl ? rgbGraphTokens(readGraphTokens()) : readGraphTokens());
      // `renderer.webgl` (Cytoscape 3.31+) isn't in its type definitions; the runtime reads it.
      const options: CytoscapeOptions & { renderer: { name: string; webgl?: boolean } } = {
        container,
        style: [...base, { selector: 'node', style: { 'min-zoomed-font-size': 9 } }, { selector: 'edge', style: { 'curve-style': 'straight', width: 1 } }],
        minZoom: 0.02,
        maxZoom: 4,
        wheelSensitivity: 0.2,
        renderer: { name: 'canvas', ...(webgl ? { webgl: true } : {}) },
      };
      cy = cytoscape(options);
      cy.on('tap', 'node', (evt) => {
        const n = evt.target as NodeSingular;
        selected = { id: n.id(), label: String(n.data('label')), kind: String(n.data('kind')) };
      });
      cy.on('tap', (evt) => { if (evt.target === cy) selected = null; });
      cy.on('dbltap', 'node', (evt) => open(String((evt.target as NodeSingular).id()), String((evt.target as NodeSingular).data('kind'))));
      cy.on('viewport', () => {
        clearTimeout(cameraTimer);
        cameraTimer = setTimeout(() => { if (cy) onState({ camera: { zoom: cy.zoom(), pan: { ...cy.pan() } } }); }, 400);
      });
      draw();
    })();
    return () => {
      disposed = true;
      clearTimeout(cameraTimer);
      worker?.terminate();
      worker = null;
      cy?.destroy();
      cy = null;
    };
  });

  $effect(() => {
    void shown;
    draw();
  });

  /** Put the shown notes on the canvas where they last were, then lay them out afresh. */
  function draw(): void {
    if (!cy || !loaded) return;
    const nodes = shown.nodes;
    cy.batch(() => {
      cy!.elements().remove();
      cy!.add([
        ...nodes.map((n) => ({ data: { id: n.id, label: n.label, kind: n.kind, root: n.id === graphState.focus ? true : undefined }, position: positions.get(n.id) ?? { x: 0, y: 0 } })),
        ...shown.edges.map((e) => ({ data: { id: `${e.source}\u0000${e.target}\u0000${e.linkType}`, source: e.source, target: e.target, linkColor: e.linkColor } })),
      ]);
    });
    const request: LayoutRequest = {
      seq: ++seq,
      nodes: nodes.map((n) => ({ id: n.id, group: n.folder || n.kind })),
      edges: shown.edges.map((e) => ({ source: e.source, target: e.target })),
    };
    worker?.postMessage(request);
  }

  let fitted = false;
  function applyPositions(r: LayoutResponse): void {
    if (!cy || r.seq !== seq) return; // a stale layout: the filters moved on
    const nodes = shown.nodes;
    cy.batch(() => {
      nodes.forEach((n, i) => {
        const p = { x: r.xy[2 * i]!, y: r.xy[2 * i + 1]! };
        positions.set(n.id, p);
        cy!.getElementById(n.id).position(p);
      });
    });
    if (!r.done || fitted) return;
    fitted = true;
    const cam = graphState.camera;
    if (cam) { cy.zoom(cam.zoom); cy.pan(cam.pan); return; }
    cy.fit(undefined, 24);
    // A handful of notes would fill the tab: fit, but no closer than 1.5×.
    if (cy.zoom() > 1.5) { cy.zoom(1.5); cy.center(); }
  }

  function open(id: string, kind: string): void {
    if (kind === 'tag') return;
    if (kind === 'source') onOpenSource?.(id.replace(/^source:/, ''));
    else onOpenNote(id);
  }

  function toggleKind(id: string): void {
    const hidden = new Set(graphState.hiddenKinds);
    if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
    onState({ hiddenKinds: [...hidden] });
  }

  const optionOrNull = (v: string) => (v === '' ? null : v);
</script>

<div class="tb-graph">
  <div class="toolbar">
    <label>Folder
      <select value={graphState.folder ?? ''} onchange={(e) => onState({ folder: optionOrNull(e.currentTarget.value) })}>
        <option value="">All</option>
        {#each folders as f (f)}<option value={f}>{f === '' ? '(top level)' : f}</option>{/each}
      </select>
    </label>
    <label>Type
      <select value={graphState.type ?? ''} onchange={(e) => onState({ type: optionOrNull(e.currentTarget.value) })}>
        <option value="">All</option>
        {#each types as t (t)}<option value={t}>{t}</option>{/each}
      </select>
    </label>
    <label>Tag
      <select value={graphState.tag ?? ''} onchange={(e) => onState({ tag: optionOrNull(e.currentTarget.value) })}>
        <option value="">All</option>
        {#each tags as t (t)}<option value={t}>#{t}</option>{/each}
      </select>
    </label>
    <label class="check"><input type="checkbox" checked={graphState.hideOrphans} onchange={(e) => onState({ hideOrphans: e.currentTarget.checked })} /> Hide orphans</label>
    <button type="button" class="toggle" class:on={graphState.showTags} aria-pressed={graphState.showTags} onclick={() => onState({ showTags: !graphState.showTags })}>Tags</button>
    {#if graphState.focus}
      <span class="focus">Around <b>{focusLabel}</b>
        <button type="button" class="step" aria-label="Fewer steps" disabled={(graphState.depth ?? 1) <= 1} onclick={() => onState({ depth: Math.max(1, (graphState.depth ?? 1) - 1) })}>−</button>
        <span>{graphState.depth ?? 1}</span>
        <button type="button" class="step" aria-label="More steps" disabled={(graphState.depth ?? 1) >= 6} onclick={() => onState({ depth: Math.min(6, (graphState.depth ?? 1) + 1) })}>+</button>
        <button type="button" onclick={() => onState({ focus: null, depth: null })}>Whole graph</button>
      </span>
    {:else if selected && selected.kind !== 'tag'}
      <button type="button" onclick={() => onState({ focus: selected!.id, depth: 1 })}>Focus on “{selected.label}”</button>
    {/if}
    <span class="spacer"></span>
    <span class="count" aria-live="polite">{shown.nodes.length} of {data.nodes.length} {data.nodes.length === 1 ? 'node' : 'nodes'}, {shown.edges.length} connections</span>
    <button type="button" class="toggle" class:on={showList} aria-pressed={showList} onclick={() => (showList = !showList)}>List</button>
  </div>
  {#if legend.length > 0}
    <div class="legend" role="group" aria-label="Connection kinds">
      {#each legend as k (k.id)}
        <button type="button" class="legend-item" class:off={graphState.hiddenKinds.includes(k.id)} aria-pressed={!graphState.hiddenKinds.includes(k.id)} onclick={() => toggleKind(k.id)}>
          <span class="swatch" style:background={k.color}></span>{k.label}
        </button>
      {/each}
    </div>
  {/if}
  {#if data.truncated}
    <p class="note">Showing the first {data.nodes.filter((n) => n.kind === 'note' || n.kind === 'term').length.toLocaleString()} of {data.total.toLocaleString()} notes. Narrow it with a folder, type or tag.</p>
  {/if}
  <div class="body">
    <div class="canvas" bind:this={container} class:hidden={showList} role="img" aria-label="Graph of {shown.nodes.length} notes; use List for the same notes as text"></div>
    {#if showList}
      <ul class="list" aria-label="Notes in the graph">
        {#each shown.nodes as n (n.id)}
          {@const links = linksOf.get(n.id) ?? []}
          <li>
            <button type="button" class="list-node" onclick={() => open(n.id, n.kind)}>{n.label}</button>
            {#if links.length > 0}
              <span class="list-links">{links.map((e) => `${e.linkLabel} ${e.source === n.id ? '→' : '←'} ${labelOf.get(e.source === n.id ? e.target : e.source) ?? ''}`).join(' · ')}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if loaded && data.nodes.length === 0}
      <div class="status">No notes to draw yet.</div>
    {/if}
  </div>
</div>

<style>
  .tb-graph { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg-inset); }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text-muted); }
  .toolbar select { font: inherit; color: var(--text); background: var(--bg-button); border: 1px solid var(--border); border-radius: 4px; margin-left: 4px; }
  .toolbar button { font: inherit; color: var(--text); background: var(--bg-button); border: 1px solid var(--border); border-radius: 4px; padding: 1px 8px; cursor: pointer; }
  .toolbar button.on { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .toolbar button:disabled { opacity: 0.5; cursor: default; }
  .check { display: inline-flex; align-items: center; gap: 4px; }
  .focus { display: inline-flex; align-items: center; gap: 6px; color: var(--text); }
  .step { min-width: 22px; }
  .spacer { flex: 1; }
  .count { font-variant-numeric: tabular-nums; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 10px; border-bottom: 1px solid var(--border); font-size: 11.5px; }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 10px; padding: 1px 8px; background: var(--bg-button); color: var(--text); cursor: pointer; font: inherit; }
  .legend-item.off { opacity: 0.45; text-decoration: line-through; }
  .swatch { width: 10px; height: 3px; border-radius: 2px; }
  .note { margin: 0; padding: 4px 10px; font-size: 12px; color: var(--text-muted); border-bottom: 1px solid var(--border); }
  .body { position: relative; flex: 1; min-height: 0; }
  .canvas { position: absolute; inset: 0; }
  .canvas.hidden { visibility: hidden; }
  .list { position: absolute; inset: 0; overflow: auto; margin: 0; padding: 8px 12px; list-style: none; font-size: 12.5px; }
  .list li { padding: 2px 0; }
  .list-node { font: inherit; color: var(--text); background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; text-decoration-color: var(--border); }
  .list-links { margin-left: 8px; color: var(--text-muted); }
  .status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 13px; }
</style>
