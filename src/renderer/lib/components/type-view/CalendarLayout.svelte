<script lang="ts">
  /**
   * The Calendar layout (#2702) through the registry's `view` (#2623) — drawn
   * by the built-in Calendar plugin in a plugin frame since #2829
   * (`plugins/calendar/`), hosted by `PluginLayout` on the View API.
   */
  import PluginLayout from '../plugins/PluginLayout.svelte';
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
</script>

<PluginLayout {view} layout="calendar" pluginId="calendar" />
