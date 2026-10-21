<script lang="ts">
  /**
   * The Timeline plugin's view (#2829): the timeline, drawn from the view
   * Minerva sends, and its export — on `export`, the drawing in export mode
   * with its styles inline, handed back with `view.provideExport`.
   */
  import { tick } from 'svelte';
  import type { MinervaPlugin, PluginViewState } from '/@minerva/plugin-api.js';
  import Timeline from './Timeline.svelte';
  import { inlineStyles } from './inline-styles';

  interface Props { minerva: MinervaPlugin }
  let { minerva }: Props = $props();

  let view = $state<PluginViewState | null>(null);

  $effect(() => minerva.on('view', (v) => { view = v; }));
  $effect(() => minerva.on('export', ({ requestId }) => {
    void (async () => {
      await tick();
      const drawing = document.querySelector<HTMLElement>('.tl');
      const html = drawing ? inlineStyles(drawing) : '<p>This view has no timeline to export.</p>';
      await minerva.view.provideExport({ requestId, html }).catch(() => undefined);
    })();
  }));
</script>

{#if view}
  <Timeline {minerva} {view} />
{/if}
