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

  Finding your way (#2959): a search box marks the matching notes and centres
  on the first (Enter steps through them); selecting a note dims everything
  beyond N steps of it; **Trace from here** then a second note shows the
  shortest connection and lists its steps (`graph-analysis.ts`, over the
  edges as drawn); dragging a note pins it (kept with the tab, **Release
  all**); right-clicking a note opens the note menu (#2773) for it, or for
  every picked note when it's one of them — ⌘/⇧-click picks several (#2935).
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { Core, CytoscapeOptions, NodeSingular, StylesheetJson } from 'cytoscape';
  import { api } from '../ipc/client';
  import { loadCytoscape } from '../graph/load-cytoscape';
  import { readGraphTokens, buildGraphStyle, rgbGraphTokens } from '../graph/cytoscape-theme';
  import { filterWholeGraph, type ThoughtbaseGraphState, type WholeGraphFilters } from '../graph/whole-graph-filter';
  import type { LayoutRequest, LayoutResponse } from '../graph/force-layout.worker';
  import type { WholeGraphResult } from '../../../shared/types';
  import { matchNodes, shortestPath, withinHops } from '../graph/graph-analysis';
  import { cyToSvg, resolveColor, svgToPngBase64 } from '../graph/graph-export';
  import { logger } from '../../../shared/logger';
  import TypeViewRowMenu from './TypeViewRowMenu.svelte';
  import type { TypeViewNoteActions } from './type-view/note-actions';

  interface Props {
    state: ThoughtbaseGraphState;
    onState: (patch: Partial<ThoughtbaseGraphState>) => void;
    /** Bumped when the graph changes. */
    revision?: number;
    onOpenNote: (relativePath: string) => void;
    onOpenSource?: (sourceId: string) => void;
    /** The note menu's actions (#2773); absent, a right-click opens nothing. */
    noteActions?: TypeViewNoteActions | undefined;
  }
  let { state: graphState, onState, revision = 0, onOpenNote, onOpenSource, noteActions }: Props = $props();

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
  // Find, focus, trace, pick (#2959).
  let query = $state('');
  let matchAt = $state(0);
  /** Notes picked for the note menu: ⌘/⇧-click adds or removes one (#2935's rules). */
  let picked = $state<string[]>([]);
  let traceFrom = $state<string | null>(null);
  let menu = $state<{ x: number; y: number; paths: string[] } | null>(null);
  /** The note the right button last went down on, for the `contextmenu` that follows; null on the background. */
  let menuNote: string | null = null;
  let accent = '#89b4fa';
  let webgl = false;

  /** The graph's style from the theme as it is now. */
  function styleSheet(): StylesheetJson {
    // WebGL parses colours itself and doesn't read the theme's oklch: hand it rgb (#2958).
    const tokens = webgl ? rgbGraphTokens(readGraphTokens()) : readGraphTokens();
    accent = tokens.accent;
    return [
      ...buildGraphStyle(tokens),
      { selector: 'node', style: { 'min-zoomed-font-size': 9 } },
      { selector: 'edge', style: { 'curve-style': 'straight', width: 1 } },
      // Find, focus, trace, pick, pin (#2959).
      { selector: '.dim', style: { opacity: 0.12 } },
      { selector: 'node.match', style: { 'border-width': 4, 'border-color': accent } },
      { selector: 'node.picked', style: { 'border-width': 3, 'border-color': accent } },
      { selector: 'node.pinned', style: { 'border-style': 'double', 'border-width': 4 } },
      { selector: 'node.path', style: { 'border-width': 4, 'border-color': accent } },
      { selector: 'edge.path', style: { width: 3, 'line-color': accent, 'target-arrow-color': accent } },
    ];
  }

  /** The app's theme changed (App calls this, as it did the per-note graph's, #3056): restyle in place. */
  export function updateTheme(): void {
    cy?.style(styleSheet());
  }
  let exportMenu = $state(false);

  $effect(() => {
    void revision;
    const tags = graphState.showTags;
    void api.graph.whole({ tags }).then((g) => { if (tags === graphState.showTags) { data = g; loaded = true; } });
  });

  // Only the filters decide what's drawn. The tab's state also carries the camera, pins and dim radius, which
  // change on every pan and drag; keyed on the filters' values, those don't re-filter and re-lay out the graph.
  const filters = $derived(JSON.stringify({
    hiddenKinds: graphState.hiddenKinds, folder: graphState.folder, type: graphState.type, tag: graphState.tag,
    hideOrphans: graphState.hideOrphans, focus: graphState.focus, depth: graphState.depth,
  }));
  const shown = $derived(filterWholeGraph(data, JSON.parse(filters) as WholeGraphFilters));
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
  const matches = $derived(matchNodes(shown.nodes, query));
  /** The shortest connection from the trace's start to the selected note; null when there is none. */
  const path = $derived(traceFrom && selected && selected.id !== traceFrom ? shortestPath(shown.edges, traceFrom, selected.id) : undefined);
  /** What stays bright around a selected note; null when nothing is selected or a trace is on. */
  const bright = $derived(selected && !traceFrom ? withinHops(shown.edges, selected.id, graphState.dimHops) : null);
  const pinCount = $derived(Object.keys(graphState.pins).length);
  const isNoteKind = (kind: string) => kind === 'note' || kind === 'term';

  /** WebGL2 where the machine has it (a GPU-less VM or remote desktop may not, #3011): `getContext` answers null then. */
  function hasWebGl(): boolean {
    return document.createElement('canvas').getContext('webgl2') !== null;
  }

  onMount(() => {
    let disposed = false;
    let cameraTimer: ReturnType<typeof setTimeout> | undefined;
    worker = new Worker(new URL('../graph/force-layout.worker.ts', import.meta.url), { type: 'module', name: 'graph-layout' });
    worker.onmessage = (e: MessageEvent<LayoutResponse>) => applyPositions(e.data);
    // Cytoscape caches where its container is; when the tab is resized or moved
    // (a sidebar, the toolbar wrapping) a click would hit the wrong node (#2959).
    const resized = new ResizeObserver(() => cy?.resize());
    if (container) resized.observe(container);
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const id = menuNote;
      menuNote = null;
      if (!id || !noteActions) return;
      if (!picked.includes(id)) picked = [id];
      menu = { x: e.clientX, y: e.clientY, paths: [...picked] };
    };
    container?.addEventListener('contextmenu', onContextMenu);
    void (async () => {
      const cytoscape = await loadCytoscape();
      if (disposed || !container) return;
      webgl = hasWebGl();
      // `renderer.webgl` (Cytoscape 3.31+) isn't in its type definitions; the runtime reads it.
      const options: CytoscapeOptions & { renderer: { name: string; webgl?: boolean } } = {
        container,
        style: styleSheet(),
        minZoom: 0.02,
        maxZoom: 4,
        wheelSensitivity: 0.2,
        renderer: { name: 'canvas', ...(webgl ? { webgl: true } : {}) },
      };
      cy = cytoscape(options);
      // The last two taps' targets (null for the background), newest last.
      const tapsBefore: (string | null)[] = [null, null];
      cy.on('tap', (evt) => { tapsBefore.shift(); tapsBefore.push(evt.target === cy ? null : String((evt.target as NodeSingular).id())); });
      cy.on('tap', 'node', (evt) => {
        const n = evt.target as NodeSingular;
        const kind = String(n.data('kind'));
        const mods = evt.originalEvent as MouseEvent | undefined;
        menu = null;
        // ⌘/⇧-click adds a note to the picked set, or takes it out (#2935's rules).
        if (mods && (mods.metaKey || mods.ctrlKey || mods.shiftKey) && isNoteKind(kind)) {
          picked = picked.includes(n.id()) ? picked.filter((p) => p !== n.id()) : [...picked, n.id()];
          return;
        }
        selected = { id: n.id(), label: String(n.data('label')), kind };
        picked = isNoteKind(kind) ? [n.id()] : [];
      });
      cy.on('tap', (evt) => { if (evt.target === cy) { selected = null; picked = []; menu = null; } });
      cy.on('tapstart scrollzoom', () => { following = null; }); // the user has the camera now
      // The note menu (#2773): for the picked notes when the right-click is on one of them, else for this note.
      // The note menu opens on the page's own `contextmenu`, for the note the right button went down on.
      // Not on Cytoscape's `cxttap` (button up): Windows fires `contextmenu` after the button comes up,
      // and it landed on the just-opened menu's backdrop, which closes it — the menu never showed.
      cy.on('cxttapstart', (evt) => {
        const n = evt.target as NodeSingular;
        menuNote = evt.target !== cy && isNoteKind(String(n.data('kind'))) ? n.id() : null;
      });
      // Dragging a note pins it there, kept with the tab (#2959).
      cy.on('dragfree', 'node', (evt) => {
        const n = evt.target as NodeSingular;
        const p = n.position();
        positions.set(n.id(), { x: p.x, y: p.y });
        onState({ pins: { ...graphState.pins, [n.id()]: { x: p.x, y: p.y } } });
      });
      // Cytoscape calls any two quick taps a double tap, wherever they land: open only when both were on this note.
      cy.on('dbltap', 'node', (evt) => {
        const n = evt.target as NodeSingular;
        if (tapsBefore[0] === n.id()) open(n.id(), String(n.data('kind')));
      });
      cy.on('viewport', () => {
        clearTimeout(cameraTimer);
        cameraTimer = setTimeout(() => { if (cy) onState({ camera: { zoom: cy.zoom(), pan: { ...cy.pan() } } }); }, 400);
      });
      draw();
    })();
    return () => {
      disposed = true;
      resized.disconnect();
      container?.removeEventListener('contextmenu', onContextMenu);
      clearTimeout(cameraTimer);
      worker?.terminate();
      worker = null;
      cy?.destroy();
      cy = null;
    };
  });

  $effect(() => {
    void shown;
    untrack(draw); // draw reads the pins and focus; only a change in what's shown redraws
  });

  /** Put the shown notes on the canvas where they last were, then lay them out afresh. */
  function draw(): void {
    if (!cy || !loaded) return;
    const nodes = shown.nodes;
    cy.batch(() => {
      cy!.elements().remove();
      cy!.add([
        ...nodes.map((n) => ({ data: { id: n.id, label: n.label, kind: n.kind, root: n.id === graphState.focus ? true : undefined }, position: graphState.pins[n.id] ?? positions.get(n.id) ?? { x: 0, y: 0 } })),
        ...shown.edges.map((e) => ({ data: { id: `${e.source}\u0000${e.target}\u0000${e.linkType}`, source: e.source, target: e.target, linkColor: e.linkColor } })),
      ]);
    });
    const request: LayoutRequest = {
      seq: ++seq,
      nodes: nodes.map((n) => ({ id: n.id, group: n.folder || n.kind, fixed: graphState.pins[n.id] })),
      edges: shown.edges.map((e) => ({ source: e.source, target: e.target })),
    };
    settled = false;
    worker?.postMessage(request);
    applyMarks();
  }

  // The marks follow what's found, selected, traced, picked and pinned.
  $effect(() => {
    void matches; void matchAt; void bright; void path; void picked; void graphState.pins;
    applyMarks();
  });

  function applyMarks(): void {
    if (!cy) return;
    const c = cy;
    c.batch(() => {
      c.elements().removeClass('match dim path picked pinned');
      for (const id of matches) c.getElementById(id).addClass('match');
      if (bright) {
        c.nodes().forEach((n) => { if (!bright.has(n.id())) n.addClass('dim'); });
        c.edges().forEach((e) => { if (!bright.has(String(e.data('source'))) || !bright.has(String(e.data('target')))) e.addClass('dim'); });
      }
      if (path) {
        for (const id of path.nodes) c.getElementById(id).addClass('path');
        for (const e of path.edges) c.getElementById(`${e.source}\u0000${e.target}\u0000${e.linkType}`).addClass('path');
      }
      for (const id of picked) c.getElementById(id).addClass('picked');
      for (const id of Object.keys(graphState.pins)) c.getElementById(id).addClass('pinned');
    });
  }

  function centreOn(id: string | undefined): void {
    following = null;
    if (!cy || !id) return;
    const n = cy.getElementById(id);
    // At once, not animated: a click straight after finding lands on the note found.
    if (n.nonempty()) cy.center(n);
    following = id; // and kept there while the layout settles, rather than fitted away from
  }
  function onFind(e: Event & { currentTarget: HTMLInputElement }): void {
    query = e.currentTarget.value;
    matchAt = 0;
    centreOn(matchNodes(shown.nodes, query)[0]);
  }
  function onFindKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter' || matches.length === 0) return;
    e.preventDefault();
    matchAt = (matchAt + (e.shiftKey ? matches.length - 1 : 1)) % matches.length;
    centreOn(matches[matchAt]);
  }
  function releaseAll(): void {
    onState({ pins: {} });
    void tick().then(draw); // lay the freed notes out again
  }
  /**
   * Save the graph as drawn (#2961): this view (what the camera shows, at the
   * screen's size) or the whole graph, as a PNG or an SVG, with a key of the
   * kinds of connection shown. A stateless save, like Export CSV.
   */
  async function exportImage(format: 'png' | 'svg', view: boolean): Promise<void> {
    exportMenu = false;
    if (!cy) return;
    const tokens = readGraphTokens();
    const svg = cyToSvg(cy, {
      view,
      legend: legend.filter((k) => !graphState.hiddenKinds.includes(k.id) && shown.edges.some((e) => e.linkType === k.id)).map((k) => ({ label: k.label, color: resolveColor(k.color) })),
      background: resolveColor(tokens.bg), text: resolveColor(tokens.text),
      title: `Graph of ${shown.nodes.length} notes and ${shown.edges.length} connections${focusLabel ? ` around ${focusLabel}` : ''}`,
    });
    const name = focusLabel ? `Graph around ${focusLabel}` : 'Graph';
    try {
      const data = format === 'svg' ? svg : await svgToPngBase64(svg, view ? cy.zoom() * 2 : 2);
      await api.export.image({ name, format, data });
    } catch (e) {
      logger('graph').warn('graph export failed:', e);
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    if (exportMenu) exportMenu = false;
    else if (menu) menu = null;
    else if (traceFrom) traceFrom = null;
    else if (selected || picked.length > 0) { selected = null; picked = []; }
    else return;
    e.preventDefault();
  }
  /** Remove Tag ▸: the picked notes' tags, with how many carry each. */
  function tagChoices(paths: readonly string[]) {
    const counts = new Map<string, number>();
    for (const n of data.nodes) if (paths.includes(n.id)) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, count]) => ({ key: t, label: `#${t}`, count }));
  }

  let fitted = false;
  /** The note Find centred on: the layout's settling keeps it centred instead of fitting the view. */
  let following: string | null = null;
  /** The layout has finished (`data-settled`): where the notes are now is where they stay. */
  let settled = $state(false);
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
    if (following) cy.center(cy.getElementById(following));
    if (!r.done) return;
    settled = true;
    if (fitted || following) return;
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tb-graph" onkeydown={onKeydown}>
  <div class="toolbar">
    <input class="find" type="search" placeholder="Find a note" aria-label="Find a note" value={query} oninput={onFind} onkeydown={onFindKey} />
    {#if query.trim() !== ''}<span class="found" aria-live="polite">{matches.length === 0 ? 'None' : `${matchAt + 1} of ${matches.length}`}</span>{/if}
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
    {#if selected && !traceFrom}
      <span class="dim-control">Bright within
        <button type="button" class="step" aria-label="Fewer steps bright" disabled={graphState.dimHops <= 1} onclick={() => onState({ dimHops: graphState.dimHops - 1 })}>−</button>
        <span>{graphState.dimHops}</span>
        <button type="button" class="step" aria-label="More steps bright" disabled={graphState.dimHops >= 6} onclick={() => onState({ dimHops: graphState.dimHops + 1 })}>+</button>
      </span>
      {#if isNoteKind(selected.kind)}<button type="button" onclick={() => (traceFrom = selected!.id)}>Trace from “{selected.label}”</button>{/if}
    {/if}
    {#if traceFrom}
      <span class="trace">From <b>{labelOf.get(traceFrom) ?? traceFrom}</b>: select another note
        <button type="button" onclick={() => (traceFrom = null)}>Clear</button>
      </span>
    {/if}
    {#if pinCount > 0}<button type="button" onclick={releaseAll}>Release all ({pinCount})</button>{/if}
    <span class="spacer"></span>
    <span class="count" aria-live="polite">{shown.nodes.length} of {data.nodes.length} {data.nodes.length === 1 ? 'node' : 'nodes'}, {shown.edges.length} connections</span>
    <button type="button" class="toggle" class:on={showList} aria-pressed={showList} onclick={() => (showList = !showList)}>List</button>
    <span class="export">
      <button type="button" aria-haspopup="menu" aria-expanded={exportMenu} disabled={showList || shown.nodes.length === 0} onclick={() => (exportMenu = !exportMenu)}>Export</button>
      {#if exportMenu}
        <div class="export-menu" role="menu" aria-label="Export the graph">
          {#each [['png', true, 'PNG of this view'], ['png', false, 'PNG of the whole graph'], ['svg', true, 'SVG of this view'], ['svg', false, 'SVG of the whole graph']] as const as [format, view, label] (label)}
            <button type="button" role="menuitem" onclick={() => void exportImage(format, view)}>{label}…</button>
          {/each}
        </div>
      {/if}
    </span>
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
  {#if path !== undefined && traceFrom && selected}
    <p class="path-steps" aria-live="polite">
      {#if path === null}
        Nothing connects <b>{labelOf.get(traceFrom)}</b> and <b>{selected.label}</b> through the connections shown.
      {:else}
        {#each path.nodes as id, i (id)}
          {#if i > 0}{@const e = path.edges[i - 1]!}<span class="step-kind"> {e.source === id ? '←' : '—'}{e.linkLabel}{e.source === id ? '—' : '→'} </span>{/if}<b>{labelOf.get(id) ?? id}</b>
        {/each}
        <span class="step-count"> · {path.edges.length} {path.edges.length === 1 ? 'step' : 'steps'}</span>
      {/if}
    </p>
  {/if}
  {#if data.truncated}
    <p class="note">Showing the first {data.nodes.filter((n) => n.kind === 'note' || n.kind === 'term').length.toLocaleString()} of {data.total.toLocaleString()} notes. Narrow it with a folder, type or tag.</p>
  {/if}
  <div class="body">
    <div class="canvas" bind:this={container} class:hidden={showList} data-settled={settled ? '' : undefined} role="img" aria-label="Graph of {shown.nodes.length} notes; use List for the same notes as text"></div>
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
    {#if menu && noteActions}
      {@const paths = menu.paths}
      <TypeViewRowMenu
        x={menu.x} y={menu.y} count={paths.length}
        onEdit={() => { menu = null; noteActions.editProperties(paths); }}
        onClose={() => (menu = null)}
        onAddTag={() => { menu = null; noteActions.addTag(paths); }}
        removeTags={tagChoices(paths)}
        onRemoveTag={(tag) => { menu = null; noteActions.removeTag(paths, tag); }}
      />
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
  .export { position: relative; }
  .export-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 5; display: flex; flex-direction: column; background: var(--bg-sidebar); border: 1px solid var(--border); border-radius: 6px; padding: 4px 0; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); min-width: 190px; }
  .export-menu button { border: none; background: none; border-radius: 0; text-align: left; padding: 5px 12px; color: var(--text); }
  .export-menu button:hover, .export-menu button:focus-visible { background: var(--bg-button); outline: none; }
  .find { font: inherit; color: var(--text); background: var(--bg-button); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; width: 160px; }
  .found { font-variant-numeric: tabular-nums; }
  .dim-control, .trace { display: inline-flex; align-items: center; gap: 6px; color: var(--text); }
  .path-steps { margin: 0; padding: 4px 10px; font-size: 12px; color: var(--text); border-bottom: 1px solid var(--border); }
  .step-kind, .step-count { color: var(--text-muted); }
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
