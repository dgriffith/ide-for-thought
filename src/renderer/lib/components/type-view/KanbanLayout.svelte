<script lang="ts">
  /**
   * The Kanban layout (#2602) through the registry's `view` (#2623) — drawn
   * by the built-in Kanban plugin in a plugin frame since #2828
   * (`plugins/kanban/`), hosted by `PluginLayout` on the View API.
   */
  import PluginLayout from '../plugins/PluginLayout.svelte';
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
</script>

<PluginLayout {view} layout="kanban" pluginId="kanban" />
