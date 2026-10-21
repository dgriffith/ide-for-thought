<script lang="ts">
  /**
   * The Timeline layout (#2608) through the registry's `view` (#2623) — drawn
   * by the built-in Timeline plugin in a plugin frame since #2829
   * (`plugins/timeline/`), hosted by `PluginLayout` on the View API.
   */
  import PluginLayout from '../plugins/PluginLayout.svelte';
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
</script>

<PluginLayout {view} layout="timeline" pluginId="timeline" />
