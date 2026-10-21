<script lang="ts">
  import type { MinervaPlugin, PluginViewState } from '/@minerva/plugin-api.js';

  interface Props { minerva: MinervaPlugin }
  let { minerva }: Props = $props();

  let view = $state<PluginViewState | null>(null);
  $effect(() => minerva.on('view', (v) => { view = v; }));
</script>

<p class="kb-status" data-kanban-plugin>
  {#if view}{view.type.label}: {view.instances.length} notes{:else}Waiting for the view…{/if}
</p>

<style>
  .kb-status { margin: 12px; color: var(--text-muted); font-family: var(--font-sans); }
</style>
