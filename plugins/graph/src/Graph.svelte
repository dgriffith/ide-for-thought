<script lang="ts">
  /**
   * A view's notes as a graph (#2960), drawn with Cytoscape (WebGL where the
   * frame has it) and laid out by the shared force layout in a worker.
   *
   * - **Nodes** are the view's notes, coloured by their own type; a note the
   *   view doesn't show but one of its notes links to is drawn faded, or left
   *   out (`outside`, the view's own, through `view.setState`).
   * - **Edges** are the view's link properties, one kind each, with a legend
   *   that turns a kind off (`edges`, likewise the view's).
   * - **Pointer**: a click goes to Minerva as any layout's does (`view.click`,
   *   #2935's rules: ⌘ toggles, ⇧ extends in the view's order, a plain click
   *   opens); hover previews (`ui.previewNote`); right-click opens the note
   *   menu (`ui.showNoteMenu`), for the selection when the note is in it.
   * - **Keyboard**: the drawing takes focus; ←/→ (or ↑/↓) move between notes
   *   in the view's sort order, Home/End to the ends, Enter opens, Space
   *   toggles, ⇧+arrow extends, ⌘A and Escape, and Shift+F10 or the menu key
   *   open the note menu. The focused note is previewed and announced.
   * - **Table** shows the same notes with their links as a table.
   */
  import { onMount, untrack } from 'svelte';
  import cytoscape, { type Core, type NodeSingular } from 'cytoscape';
  import type { MinervaPlugin, PluginViewState } from '/@minerva/plugin-api.js';
  import type { GraphViewModel } from '../../../src/shared/objects/graph-view';
  import type { LayoutRequest, LayoutResponse } from './layout.worker';
  import { KIND_TOKENS, rgb, token } from './colors';
  import LinksTable from './LinksTable.svelte';

  interface Props { minerva: MinervaPlugin; view: PluginViewState; model: GraphViewModel }
  let { minerva, view, model }: Props = $props();

  const quietly = (p: Promise<unknown>) => { void p.catch(() => undefined); };

  let container = $state<HTMLDivElement>();
  let showTable = $state(false);
  let focused = $state<string | null>(null);
  let cy: Core | null = null;
  let worker: Worker | null = null;
  let seq = 0;
  let fitted = false;
  const positions = new Map<string, { x: number; y: number }>();

  const selectable = $derived(view.selectable && !view.exportMode);
  const selected = $derived(new Set(view.selected));
  const nodeById = $derived(new Map(model.nodes.map((n) => [n.id, n] as const)));
  /** The keyboard's order: the view's notes in its sort, then the notes outside it. */
  const order = $derived(model.nodes.map((n) => n.id));
  const kindColor = $derived(new Map(model.kinds.map((k, i) => [k.property, KIND_TOKENS[i % KIND_TOKENS.length]!] as const)));

  function webgl(): boolean {
    return document.createElement('canvas').getContext('webgl2') !== null;
  }

  function style(): cytoscape.StylesheetJson {
    const text = token('--text', 'rgb(40, 40, 40)');
    const accent = token('--accent', 'rgb(137, 180, 250)');
    const bg = token('--bg-elev-2', 'rgb(230, 230, 230)');
    const border = token('--border-strong', 'rgb(160, 160, 160)');
    return [
      { selector: 'node', style: {
        label: 'data(label)', color: text, 'font-size': 11, 'text-valign': 'center', 'text-halign': 'center',
        shape: 'round-rectangle', width: 'label', height: 'label', padding: '6px',
        'background-color': bg, 'border-width': 2, 'border-color': 'data(color)', 'min-zoomed-font-size': 8,
        'text-max-width': '160px', 'text-wrap': 'ellipsis',
      } },
      { selector: 'node.outside', style: { opacity: 0.5, 'border-style': 'dashed', 'border-color': border } },
      { selector: 'node.selected', style: { 'border-width': 4, 'border-color': accent, 'background-color': rgb(`color-mix(in srgb, ${getComputedStyle(document.documentElement).getPropertyValue('--accent')} 18%, ${getComputedStyle(document.documentElement).getPropertyValue('--bg-elev-2')})`, bg) } },
      { selector: 'node.focused', style: { 'overlay-color': accent, 'overlay-opacity': 0.18, 'overlay-padding': 6 } },
      { selector: 'edge', style: {
        width: 1.5, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8, 'curve-style': 'straight', opacity: 0.85,
      } },
      { selector: 'edge.outside', style: { 'line-style': 'dashed', opacity: 0.45 } },
    ];
  }

  function elements(): cytoscape.ElementDefinition[] {
    const fallback = token('--border-strong', 'rgb(160, 160, 160)');
    const kinds = new Map([...kindColor].map(([k, t]) => [k, token(t, fallback)] as const));
    return [
      ...model.nodes.map((n) => ({
        group: 'nodes' as const,
        data: { id: n.id, label: n.label, color: n.color ? rgb(n.color, fallback) : fallback },
        classes: [n.outside ? 'outside' : '', selected.has(n.id) ? 'selected' : '', focused === n.id ? 'focused' : ''].filter(Boolean),
        position: positions.get(n.id) ?? { x: 0, y: 0 },
      })),
      ...model.edges.map((e) => ({
        group: 'edges' as const,
        data: { id: `${e.source}\u0000${e.target}\u0000${e.property}`, source: e.source, target: e.target, color: kinds.get(e.property) ?? fallback },
        classes: e.outside ? ['outside'] : [],
      })),
    ];
  }

  /** Redraw the elements and lay out anew; positions already found are kept as the start. */
  function draw(): void {
    if (!cy) return;
    const c = cy;
    c.batch(() => {
      c.elements().remove();
      c.add(elements());
    });
    const s = ++seq;
    const request: LayoutRequest = {
      seq: s,
      nodes: model.nodes.map((n) => ({ id: n.id, group: n.outside ? '~outside' : n.typeLabel ?? '' })),
      edges: model.edges.map((e) => ({ source: e.source, target: e.target })),
    };
    worker?.postMessage(request);
  }

  function onPositions(r: LayoutResponse): void {
    if (!cy || r.seq !== seq) return;
    const c = cy;
    const nodes = model.nodes;
    c.batch(() => {
      for (let i = 0; i < nodes.length; i++) {
        const p = { x: r.xy[2 * i]!, y: r.xy[2 * i + 1]! };
        positions.set(nodes[i]!.id, p);
        c.getElementById(nodes[i]!.id).position(p);
      }
    });
    if (r.done && !fitted) {
      fitted = true;
      c.fit(undefined, 24);
      if (c.zoom() > 1.5) { c.zoom(1.5); c.center(); }
    }
  }

  // What the graph holds: a change of notes or links redraws it; selection and focus only re-mark it.
  const shape = $derived(JSON.stringify([model.nodes.map((n) => [n.id, n.label, n.color, n.outside]), model.edges.map((e) => [e.source, e.target, e.property])]));
  $effect(() => {
    void shape;
    untrack(draw);
  });
  $effect(() => {
    const sel = selected;
    const f = focused;
    if (!cy) return;
    const c = cy;
    c.batch(() => {
      c.nodes().forEach((n) => {
        n.toggleClass('selected', sel.has(n.id()));
        n.toggleClass('focused', n.id() === f);
      });
    });
  });

  onMount(() => {
    worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module', name: 'graph-layout' });
    worker.onmessage = (e: MessageEvent<LayoutResponse>) => onPositions(e.data);
    const options = {
      container,
      style: style(),
      wheelSensitivity: 0.3,
      boxSelectionEnabled: false,
      autoungrabify: false,
      ...(webgl() ? { renderer: { name: 'canvas', webgl: true } } : {}),
    } as cytoscape.CytoscapeOptions & { renderer?: { name: string; webgl?: boolean } };
    const c = cytoscape(options);
    cy = c;
    c.on('tap', 'node', (evt) => {
      const n = evt.target as NodeSingular;
      const mods = evt.originalEvent as MouseEvent | undefined;
      focused = n.id();
      click(n.id(), mods);
    });
    c.on('cxttap', 'node', (evt) => {
      const n = evt.target as NodeSingular;
      const at = evt.originalEvent;
      focused = n.id();
      menu(n.id(), at.clientX, at.clientY);
    });
    c.on('mouseover', 'node', (evt) => preview((evt.target as NodeSingular).id(), 'pointer'));
    c.on('mouseout', 'node', (evt) => unpreview((evt.target as NodeSingular).id(), 'pointer'));
    // Cytoscape caches where its container is: tell it when the frame resizes.
    const resized = new ResizeObserver(() => c.resize());
    if (container) resized.observe(container);
    draw();
    return () => {
      resized.disconnect();
      worker?.terminate();
      worker = null;
      c.destroy();
      cy = null;
    };
  });

  // Theme changes arrive as new tokens on :root: restyle.
  onMount(() => {
    const observer = new MutationObserver(() => {
      if (!cy) return;
      cy.style(style());
      untrack(draw);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    return () => observer.disconnect();
  });

  function click(path: string, mods?: MouseEvent): void {
    const node = nodeById.get(path);
    if (node?.outside) { quietly(minerva.ui.openNote({ path })); return; }
    if (!selectable || !mods) { quietly(minerva.view.click({ path })); return; }
    quietly(minerva.view.click({ path, meta: mods.metaKey, ctrl: mods.ctrlKey, shift: mods.shiftKey }));
  }

  function menu(path: string, x: number, y: number): void {
    if (!view.rowMenu) return;
    unpreview(path, 'pointer');
    unpreview(path, 'focus');
    // A selected note's menu is the selection's; any other's, its own (Kanban's rule, #2937).
    const paths = selectable && selected.has(path) ? view.selected : [path];
    quietly(minerva.ui.showNoteMenu({ paths, x, y }));
  }

  /** Where a node is drawn, in the frame. */
  function nodeBox(path: string): { x: number; y: number; width: number; height: number } | null {
    if (!cy || !container) return null;
    const n = cy.getElementById(path);
    if (n.empty()) return null;
    const bb = n.renderedBoundingBox();
    const r = container.getBoundingClientRect();
    return { x: r.left + bb.x1, y: r.top + bb.y1, width: bb.w, height: bb.h };
  }

  function preview(path: string, via: 'pointer' | 'focus'): void {
    const box = nodeBox(path);
    if (!box) return;
    const n = nodeById.get(path);
    quietly(minerva.ui.previewNote({ path, ...box, via, ...(n?.outside ? { extra: ['Not in this view'] } : {}) }));
  }
  function unpreview(path: string, via: 'pointer' | 'focus'): void {
    quietly(minerva.ui.hidePreview({ path, via }));
  }

  function focusNode(path: string | undefined, opts: { extend?: boolean } = {}): void {
    if (!path) return;
    const was = focused;
    if (was) unpreview(was, 'focus');
    focused = path;
    if (opts.extend && selectable && !nodeById.get(path)?.outside) {
      if (view.selected.length === 0 && was && !nodeById.get(was)?.outside) quietly(minerva.view.click({ path: was, meta: true }));
      quietly(minerva.view.click({ path, shift: true }));
    }
    const n = cy?.getElementById(path);
    if (cy && n && n.nonempty()) {
      const ext = cy.extent();
      const p = n.position();
      if (p.x < ext.x1 || p.x > ext.x2 || p.y < ext.y1 || p.y > ext.y2) cy.center(n);
    }
    const node = nodeById.get(path);
    const links = model.edges.filter((e) => e.source === path || e.target === path).length;
    quietly(minerva.ui.announce({ text: `${node?.label ?? path}${node?.typeLabel ? `, ${node.typeLabel}` : ''}${node?.outside ? ', not in this view' : ''}, ${links} ${links === 1 ? 'link' : 'links'}` }));
    preview(path, 'focus');
  }

  function onKeydown(e: KeyboardEvent): void {
    const at = focused ? order.indexOf(focused) : -1;
    const step = (d: number) => order[at === -1 ? (d > 0 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, at + d))];
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
      if (!selectable) return;
      e.preventDefault();
      quietly(minerva.view.selectAll());
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': e.preventDefault(); focusNode(step(1), { extend: e.shiftKey }); return;
      case 'ArrowLeft': case 'ArrowUp': e.preventDefault(); focusNode(step(-1), { extend: e.shiftKey }); return;
      case 'Home': e.preventDefault(); focusNode(order[0]); return;
      case 'End': e.preventDefault(); focusNode(order[order.length - 1]); return;
      case 'Enter': if (focused) { e.preventDefault(); click(focused); } return;
      case ' ':
        if (focused && selectable && !nodeById.get(focused)?.outside) { e.preventDefault(); quietly(minerva.view.click({ path: focused, meta: true })); }
        return;
      case 'Escape':
        if (selectable && view.selected.length > 0) { e.preventDefault(); quietly(minerva.view.clearSelection()); }
        return;
      case 'ContextMenu': case 'F10':
        if (focused && (e.key === 'ContextMenu' || e.shiftKey)) {
          e.preventDefault();
          const box = nodeBox(focused);
          if (box) menu(focused, box.x + box.width / 2, box.y + box.height / 2);
        }
        return;
    }
  }

  function setKinds(property: string): void {
    const on = model.kinds.filter((k) => (k.property === property ? !k.on : k.on)).map((k) => k.property);
    quietly(minerva.view.setState({ patch: { edges: on.length === model.kinds.length ? null : on } }));
  }

  const notes = $derived(model.nodes.filter((n) => !n.outside).length);
  const outsideCount = $derived(model.nodes.length - notes);
</script>

<div class="gv">
  <div class="gv-bar">
    <div class="gv-legend" role="group" aria-label="Links drawn">
      {#each model.kinds as k (k.property)}
        <button type="button" class="gv-kind" aria-pressed={k.on} disabled={view.readOnly} onclick={() => setKinds(k.property)}>
          <span class="gv-swatch" style="background: var({kindColor.get(k.property)})"></span>{k.label} <span class="gv-n">{k.count}</span>
        </button>
      {/each}
    </div>
    {#if !view.readOnly}
      <label class="gv-check">
        <input type="checkbox" checked={view.spec['outside'] !== 'hide'} onchange={(e) => quietly(minerva.view.setState({ patch: { outside: e.currentTarget.checked ? 'show' : 'hide' } }))} />
        Outside notes
      </label>
    {/if}
    <span class="gv-count">{notes} {notes === 1 ? 'note' : 'notes'}{outsideCount > 0 ? ` + ${outsideCount} outside` : ''}, {model.edges.length} {model.edges.length === 1 ? 'link' : 'links'}</span>
    <button type="button" class="gv-btn" onclick={() => { cy?.fit(undefined, 24); }} disabled={showTable}>Fit</button>
    <button type="button" class="gv-btn" aria-pressed={showTable} onclick={() => (showTable = !showTable)}>Table</button>
  </div>
  <div class="gv-body">
    <!-- An application: the drawing has its own keyboard model, described in its label, so it takes focus. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="gv-canvas" bind:this={container} hidden={showTable}
      tabindex="0" role="application"
      aria-label={`Graph of ${notes} notes and ${model.edges.length} links. Arrow keys move between notes, Enter opens one${view.rowMenu ? ', Shift+F10 opens its menu' : ''}. Table lists them.`}
      onkeydown={onKeydown}
      onfocus={() => { if (!focused) focusNode(order[0]); }}
      onblur={() => { if (focused) unpreview(focused, 'focus'); }}
    ></div>
    {#if showTable}
      <div class="gv-table-wrap"><LinksTable {model} onOpen={(path, outside) => (outside ? quietly(minerva.ui.openNote({ path })) : click(path))} /></div>
    {/if}
    {#if model.nodes.length === 0}<p class="gv-empty">No notes to draw.</p>{/if}
  </div>
</div>

<style>
  .gv { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .gv-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text-muted); }
  .gv-legend { display: inline-flex; flex-wrap: wrap; gap: 6px; }
  .gv-kind { display: inline-flex; align-items: center; gap: 5px; font: inherit; color: var(--text); background: var(--bg-button); border: 1px solid var(--border); border-radius: 10px; padding: 1px 8px; cursor: pointer; }
  .gv-kind[aria-pressed='false'] { color: var(--text-faint); text-decoration: line-through; }
  .gv-kind:disabled { cursor: default; }
  .gv-swatch { width: 12px; height: 3px; border-radius: 2px; }
  .gv-n { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .gv-check { display: inline-flex; align-items: center; gap: 4px; }
  .gv-count { margin-left: auto; font-variant-numeric: tabular-nums; }
  .gv-btn { font: inherit; color: var(--text); background: var(--bg-button); border: 1px solid var(--border); border-radius: 4px; padding: 1px 8px; cursor: pointer; }
  .gv-btn[aria-pressed='true'] { border-color: var(--accent); }
  .gv-body { position: relative; flex: 1; min-height: 0; overflow: auto; }
  .gv-canvas { position: absolute; inset: 0; }
  .gv-canvas:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .gv-table-wrap { padding: 4px 6px; }
  .gv-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; margin: 0; color: var(--text-muted); }
</style>
