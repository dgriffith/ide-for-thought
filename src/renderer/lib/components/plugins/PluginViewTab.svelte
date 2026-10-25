<script lang="ts">
  /**
   * A plugin's global view in an editor tab (#2640): its frame, fed by the
   * query it declares, as in its sidebar panel. With the plugin off (a tab
   * restored from an earlier session), one line says which plugin to turn on.
   */
  import PluginPanel from './PluginPanel.svelte';
  import { codePluginsStore } from '../../stores/code-plugins.svelte';

  interface Props { pluginId: string; viewId: string; title: string }
  let { pluginId, viewId, title }: Props = $props();

  // undefined while the plugin list loads: nothing yet, rather than a flash of "off".
  const active = $derived(codePluginsStore.view(pluginId, viewId));
</script>

{#if active}
  {#key `${pluginId}:${viewId}`}
    <div class="plugin-view-tab">
      <PluginPanel pluginId={active.pluginId} viewId={active.view.id} entry={active.view.entry} title={active.view.title} />
    </div>
  {/key}
{:else if active === null}
  <div class="plugin-view-off">
    <p>{title} is turned off on this machine. Turn on {codePluginsStore.name(pluginId)} in Settings → Plugins to see it.</p>
  </div>
{/if}

<style>
  .plugin-view-tab {
    flex: 1;
    min-height: 0;
  }
  .plugin-view-off {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .plugin-view-off p {
    color: var(--text-muted);
  }
</style>
