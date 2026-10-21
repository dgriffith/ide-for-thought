<script lang="ts">
  /**
   * The Kanban plugin's view (#2828): the board, drawn from the view Minerva
   * sends, and its export — on `export`, the board in export mode with its
   * styles inline, handed back with `view.provideExport`.
   */
  import { tick } from 'svelte';
  import type { MinervaPlugin, PluginViewState } from '/@minerva/plugin-api.js';
  import Board from './Board.svelte';
  import { inlineStyles } from './inline-styles';

  interface Props { minerva: MinervaPlugin }
  let { minerva }: Props = $props();

  let view = $state<PluginViewState | null>(null);

  $effect(() => minerva.on('view', (v) => { view = v; }));
  $effect(() => minerva.on('export', ({ requestId }) => {
    void (async () => {
      await tick();
      const board = document.querySelector<HTMLElement>('.kb-board');
      const html = board ? inlineStyles(board) : '<p>This view has no board to export.</p>';
      await minerva.view.provideExport({ requestId, html }).catch(() => undefined);
    })();
  }));
</script>

{#if view}
  <Board {minerva} {view} />
{/if}
