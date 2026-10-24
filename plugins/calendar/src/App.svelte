<script lang="ts">
  /**
   * The Calendar plugin's view (#2829): the calendar, drawn from the view
   * Minerva sends, and its export — on `export`, the drawing in export mode
   * with its styles inline, handed back with `view.provideExport`.
   */
  import { tick } from 'svelte';
  import type { MinervaPlugin, PluginViewState } from '/@minerva/plugin-api.js';
  import Calendar from './Calendar.svelte';
  import { inlineStyles } from './inline-styles';

  interface Props { minerva: MinervaPlugin }
  let { minerva }: Props = $props();

  let view = $state<PluginViewState | null>(null);

  $effect(() => minerva.on('view', (v) => { view = v; }));
  $effect(() => minerva.on('export', ({ requestId }) => {
    void (async () => {
      await tick();
      const drawing = document.querySelector<HTMLElement>('.cal');
      const html = drawing ? inlineStyles(drawing) : '<p>This view has no calendar to export.</p>';
      await minerva.view.provideExport({ requestId, html }).catch(() => undefined);
    })();
  }));
</script>

{#if view}
  <Calendar {minerva} {view} />
{/if}
