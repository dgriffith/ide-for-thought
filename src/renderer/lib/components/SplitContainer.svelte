<script lang="ts">
  /**
   * Recursively renders the editor split layout (#813). A leaf delegates to the
   * `leaf` snippet (which mounts a group's pane); a split lays its children out
   * as a flex row (`horizontal`) or column (`vertical`) with draggable dividers
   * between them. Sizes are fractional; dragging a divider redistributes the
   * two adjacent panes only, clamped to a per-pane minimum.
   */
  import type { Snippet } from 'svelte';
  import {
    type LayoutNode,
    collectGroupIds,
  } from '../editor/layout-tree';
  import { redistributeSizes } from '../editor/split-resize';
  import ResizeHandle from './ResizeHandle.svelte';
  import SplitContainer from './SplitContainer.svelte';

  interface Props {
    node: LayoutNode;
    /** Renders one pane's content for a given groupId. */
    leaf: Snippet<[string]>;
  }

  let { node, leaf }: Props = $props();

  /** Minimum pane extent along the split axis, in px. */
  const MIN_PX = 140;

  let containerEl = $state<HTMLDivElement>();

  function keyOf(child: LayoutNode): string {
    return child.kind === 'leaf' ? `leaf:${child.groupId}` : `split:${collectGroupIds(child).join(',')}`;
  }

  function handleResize(index: number, deltaPx: number) {
    if (node.kind !== 'split' || !containerEl) return;
    const total = node.direction === 'horizontal' ? containerEl.clientWidth : containerEl.clientHeight;
    if (total <= 0) return;
    node.sizes = redistributeSizes(node.sizes, index, deltaPx / total, MIN_PX / total);
  }
</script>

{#if node.kind === 'leaf'}
  {@render leaf(node.groupId)}
{:else}
  <div class="split-container {node.direction}" bind:this={containerEl}>
    {#each node.children as child, i (keyOf(child))}
      <div
        class="split-child"
        style:flex="{node.sizes[i] ?? 1 / node.children.length} 1 0"
        style:min-width={node.direction === 'horizontal' ? `${MIN_PX}px` : null}
        style:min-height={node.direction === 'vertical' ? `${MIN_PX}px` : null}
      >
        <SplitContainer node={child} {leaf} />
      </div>
      {#if i < node.children.length - 1}
        <ResizeHandle direction={node.direction} onResize={(d) => handleResize(i, d)} />
      {/if}
    {/each}
  </div>
{/if}

<style>
  .split-container {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .split-container.horizontal { flex-direction: row; }
  .split-container.vertical { flex-direction: column; }
  .split-child {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
</style>
