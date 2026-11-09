<script lang="ts">
  /**
   * The Graph plugin's view (#2960): the graph, drawn from the view Minerva
   * sends, and its export — on `export`, the notes and their links as a
   * table (`LinksTable`, the graph's accessible equivalent), styled inline,
   * handed back with `view.provideExport`. Drawing the graph itself into an
   * export is #2961's.
   */
  import { tick } from 'svelte';
  import type { MinervaPlugin, PluginViewState } from '/@minerva/plugin-api.js';
  import Graph from './Graph.svelte';
  import LinksTable from './LinksTable.svelte';
  import { graphViewModel, parseGraphEdges, parseGraphOutside } from '../../../src/shared/objects/graph-view';

  interface Props { minerva: MinervaPlugin }
  let { minerva }: Props = $props();

  let view = $state<PluginViewState | null>(null);
  let exportRoot = $state<HTMLDivElement>();

  $effect(() => minerva.on('view', (v) => { view = v; }));
  $effect(() => minerva.on('export', ({ requestId }) => {
    void (async () => {
      await tick();
      const table = exportRoot?.querySelector<HTMLElement>('table');
      const html = table ? table.outerHTML : '<p>This view has no notes to export.</p>';
      await minerva.view.provideExport({ requestId, html }).catch(() => undefined);
    })();
  }));

  const model = $derived(view ? graphViewModel(view.instances, view.properties, { edges: parseGraphEdges(view.spec['edges']), outside: parseGraphOutside(view.spec['outside']) }) : null);
</script>

{#if view && model}
  {#if view.exportMode}
    <div bind:this={exportRoot}><LinksTable {model} inline /></div>
  {:else}
    <Graph {minerva} {view} {model} />
  {/if}
{/if}
