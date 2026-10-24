<script lang="ts">
  /**
   * A plugin panel's header action (#2640): open the same global view as an
   * editor tab, where it has room. The tab is its own frame and session, fed
   * by the same declared query.
   */
  import { getEditorStore } from '../../stores/editor.svelte';
  import type { ActivePluginView } from '../../stores/core-plugins.svelte';

  interface Props { view: ActivePluginView }
  let { view }: Props = $props();

  const editor = getEditorStore();
</script>

<button
  class="open-in-tab"
  title="Open in a tab"
  aria-label={`Open ${view.view.title} in a tab`}
  onclick={() => editor.openPluginView(view.pluginId, view.view.id, view.view.title)}
>Open in tab</button>

<style>
  .open-in-tab {
    font: inherit;
    font-size: 11px;
    color: var(--text-faint);
    background: none;
    border: 0;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
  }
  .open-in-tab:hover { color: var(--accent); background: var(--bg-button-hover); }
  .open-in-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
