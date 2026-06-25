<script lang="ts">
  /**
   * Draggable divider between two split siblings (#813). Reports incremental
   * pixel deltas along its axis; the parent `SplitContainer` converts them to
   * fractional size changes against the measured container. Built standalone so
   * it can later retrofit the fixed-width sidebars.
   *
   * `direction` is the parent split's layout direction: `horizontal` lays panes
   * left↔right, so this is a vertical bar dragged on the x-axis (col-resize);
   * `vertical` lays panes top↕bottom, a horizontal bar on the y-axis.
   */
  import type { SplitDirection } from '../editor/layout-tree';

  interface Props {
    direction: SplitDirection;
    /** Incremental drag distance in px since the last move, along the axis. */
    onResize: (deltaPx: number) => void;
    onResizeEnd?: () => void;
  }

  let { direction, onResize, onResizeEnd }: Props = $props();

  let dragging = $state(false);
  let last = 0;

  function coord(e: PointerEvent): number {
    return direction === 'horizontal' ? e.clientX : e.clientY;
  }

  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
    last = coord(e);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const cur = coord(e);
    const delta = cur - last;
    if (delta !== 0) {
      last = cur;
      onResize(delta);
    }
  }

  function endDrag(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    onResizeEnd?.();
  }
</script>

<div
  class="resize-handle {direction}"
  class:dragging
  role="separator"
  aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
></div>

<style>
  .resize-handle {
    flex: 0 0 auto;
    background: var(--border);
    z-index: 2;
  }
  .resize-handle.horizontal {
    width: 1px;
    cursor: col-resize;
    /* Widen the hit target without taking layout width. */
    margin: 0 -2px;
    padding: 0 2px;
    background-clip: content-box;
  }
  .resize-handle.vertical {
    height: 1px;
    cursor: row-resize;
    margin: -2px 0;
    padding: 2px 0;
    background-clip: content-box;
  }
  .resize-handle:hover,
  .resize-handle.dragging {
    background-color: var(--accent);
  }
</style>
