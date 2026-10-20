<script lang="ts">
  /**
   * Stands in for TypeView drawing a plugin layout in an export (#2828): it
   * loads, shows a not-yet-drawn plugin layout, then — when `drawAfterMs` is
   * set — draws its "sanitized" markup and calls `pluginExport.onRendered`.
   */
  import { onMount } from 'svelte';
  import type { PluginExportHooks } from '../../../../src/renderer/lib/components/type-view/layout-view';

  interface Props {
    onLoaded?: () => void;
    pluginExport?: PluginExportHooks;
    drawAfterMs?: number | null;
  }
  // `__fakeFail`: report a failure instead of drawing.
  const g = globalThis as { __fakeDrawAfterMs?: number | null };
  let { onLoaded, pluginExport, drawAfterMs = '__fakeDrawAfterMs' in g ? g.__fakeDrawAfterMs : 10 }: Props = $props();
  let drawn = $state(false);

  onMount(() => {
    onLoaded?.();
    if ((g as { __fakeFail?: string }).__fakeFail) {
      queueMicrotask(() => pluginExport?.onFailed((g as { __fakeFail?: string }).__fakeFail!));
      return;
    }
    if (drawAfterMs === null) return;
    setTimeout(() => {
      drawn = true;
      queueMicrotask(() => pluginExport?.onRendered());
    }, drawAfterMs);
  });
</script>

<div data-plugin-layout="kanban">
  {#if drawn}<p class="drawn">The board, drawn.</p>{:else}<div class="frame-stand-in">frame</div>{/if}
</div>
