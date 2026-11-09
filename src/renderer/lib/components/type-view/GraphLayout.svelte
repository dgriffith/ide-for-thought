<script lang="ts">
  /**
   * The Graph layout (#2960) through the registry's `view` — drawn by the
   * built-in Graph plugin in a plugin frame (`plugins/graph/`), hosted by
   * `PluginLayout` on the View API, as Kanban, Timeline and Calendar are.
   */
  import PluginLayout from '../plugins/PluginLayout.svelte';
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
</script>

<PluginLayout {view} layout="graph" pluginId="graph" />
