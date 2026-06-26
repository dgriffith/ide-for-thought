<!--
  GraphCanvas — the reusable Cytoscape host both graph views mount (#843 / #844).

  Owns the cytoscape instance lifecycle (lazy-load → create → destroy), themes it
  from the Catppuccin tokens, re-fits on resize, and implements the shared click
  model (#849): single-click selects, double-click (or Enter) navigates; with
  `autoNavigate` on, single-click navigates immediately. Each view supplies its
  own `navigate(data)` action (View A scrolls to a heading, View B opens a note /
  source), so both inherit identical behavior.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Core, ElementDefinition, LayoutOptions, NodeSingular } from 'cytoscape';
  import { loadCytoscape } from '../graph/load-cytoscape';
  import { readGraphTokens, buildGraphStyle } from '../graph/cytoscape-theme';

  interface Props {
    /** Cytoscape elements, split into nodes + edges. */
    elements: { nodes: ElementDefinition[]; edges: ElementDefinition[] };
    /** Cytoscape layout options (e.g. breadthfirst for View A, cose for View B). */
    layout?: LayoutOptions;
    /** #849 — when on, a single click navigates instead of selecting. */
    autoNavigate?: boolean;
    /** The view's navigate action, given the clicked node's data. */
    navigate?: (data: Record<string, unknown>) => void;
  }

  let {
    elements,
    layout = { name: 'breadthfirst' },
    autoNavigate = false,
    navigate,
  }: Props = $props();

  let container = $state<HTMLDivElement>();
  let cy: Core | null = null;
  let ready = $state(false);

  // Double-tap detection (cytoscape has no native double-click event).
  let lastTapId = '';
  let lastTapTime = 0;

  function activate(node: NodeSingular): void {
    navigate?.(node.data() as Record<string, unknown>);
  }

  onMount(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;

    void (async () => {
      const cytoscape = await loadCytoscape();
      if (disposed || !container) return;
      cy = cytoscape({
        container,
        style: buildGraphStyle(readGraphTokens()),
        minZoom: 0.2,
        maxZoom: 3,
        wheelSensitivity: 0.2,
      });

      cy.on('tap', 'node', (evt) => {
        const node = evt.target as NodeSingular;
        if (autoNavigate) { activate(node); return; }
        const now = Date.now();
        if (lastTapId === node.id() && now - lastTapTime < 300) activate(node);
        lastTapId = node.id();
        lastTapTime = now;
      });

      // Re-fit when the container resizes (sidebar width / pane resize).
      ro = new ResizeObserver(() => { cy?.resize(); cy?.fit(undefined, 24); });
      ro.observe(container);

      ready = true;
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      cy?.destroy();
      cy = null;
    };
  });

  // Populate + live-update: (re)load elements and re-run layout whenever they
  // change (or once the instance becomes ready).
  $effect(() => {
    const els = elements;
    if (!ready || !cy) return;
    cy.batch(() => {
      cy!.elements().remove();
      cy!.add([...els.nodes, ...els.edges]);
    });
    cy.layout(layout).run();
    cy.fit(undefined, 24);
  });

  /** Re-skin the live graph from the current palette — wired to the theme switch. */
  export function updateTheme(): void {
    cy?.style(buildGraphStyle(readGraphTokens()));
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && cy) {
      const sel = cy.$('node:selected');
      if (sel.length > 0) { e.preventDefault(); activate(sel[0]); }
    }
  }
</script>

<div
  class="graph-canvas"
  bind:this={container}
  tabindex="0"
  role="application"
  aria-label="Graph"
  onkeydown={onKeydown}
></div>

<style>
  .graph-canvas {
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--bg-inset);
    outline: none;
  }
  .graph-canvas:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
</style>
