<script lang="ts">
  /**
   * A plugin's global view as a sidebar panel (#2640): its page in a plugin
   * frame (`PluginFrame`), connected as the view, so main runs the query the
   * view declares and scopes the session to the notes it names. This host
   * asks for a re-run whenever the graph changes; it never says which notes.
   */
  import PluginFrame from './PluginFrame.svelte';
  import { getGraphRevisionStore } from '../../stores/graph-revision.svelte';
  import type { PluginFrameConnection } from '../../stores/plugin-sessions.svelte';
  import { logger } from '../../../../shared/logger';

  interface Props {
    pluginId: string;
    viewId: string;
    entry: string;
    title: string;
  }

  let { pluginId, viewId, entry, title }: Props = $props();

  const graph = getGraphRevisionStore();
  let connection = $state<PluginFrameConnection | null>(null);

  function refresh(): void {
    void connection?.refreshQuery().catch((e: unknown) => logger('plugins').warn(`plugin ${pluginId}: view ${viewId} not refreshed:`, e));
  }

  // On connect, and again whenever the graph moves.
  $effect(() => {
    void graph.revision;
    if (connection) refresh();
  });
</script>

<div class="plugin-panel">
  <PluginFrame {pluginId} {entry} target={{ view: viewId }} scope={[]} {title} onConnected={(c) => { connection = c; }} />
</div>

<style>
  .plugin-panel {
    height: 100%;
    min-height: 0;
  }
</style>
