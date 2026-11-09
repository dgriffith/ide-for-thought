<script lang="ts">
  /**
   * The Graph plugin's view (#2960): the graph, drawn from the view Minerva
   * sends, and its export (#2961) — on `export`, the graph as a still SVG
   * with a key of its kinds of link (`export-svg.ts`), handed back with
   * `view.provideExport`.
   */
  import { tick } from 'svelte';
  import type { MinervaPlugin, PluginViewState } from '/@minerva/plugin-api.js';
  import Graph from './Graph.svelte';
  import { exportSvg } from './export-svg';
  import { graphViewModel, parseGraphEdges, parseGraphOutside } from '../../../src/shared/objects/graph-view';

  interface Props { minerva: MinervaPlugin }
  let { minerva }: Props = $props();

  let view = $state<PluginViewState | null>(null);

  $effect(() => minerva.on('view', (v) => { view = v; }));
  $effect(() => minerva.on('export', ({ requestId }) => {
    void (async () => {
      await tick();
      const m = model;
      const html = m && m.nodes.length > 0
        ? `<div style="width: 100%;">${exportSvg(m, `Graph of ${view?.type.label ?? 'notes'}: ${m.nodes.length} notes, ${m.edges.length} links`).replace('<svg ', '<svg style="width: 100%; height: auto; display: block;" ')}</div>`
        : '<p>This view has no notes to draw.</p>';
      await minerva.view.provideExport({ requestId, html }).catch(() => undefined);
    })();
  }));

  const model = $derived(view ? graphViewModel(view.instances, view.properties, { edges: parseGraphEdges(view.spec['edges']), outside: parseGraphOutside(view.spec['outside']) }) : null);
</script>

{#if view && model && !view.exportMode}
  <Graph {minerva} {view} {model} />
{/if}
