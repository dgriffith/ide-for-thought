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

  /** Pixels nudged per arrow-key press (keyboard divider operation, #817). */
  const KEY_STEP = 24;

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

  /**
   * Keyboard operation (#817 a11y): the focused divider nudges the boundary by
   * a fixed step. Arrow keys map to the split axis — Left/Right for a vertical
   * bar (horizontal split), Up/Down for a horizontal bar (vertical split) —
   * with "forward" growing the leading pane, matching a rightward/downward drag.
   */
  function onKeydown(e: KeyboardEvent) {
    const forward = direction === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const backward = direction === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    let delta: number;
    if (e.key === forward) delta = KEY_STEP;
    else if (e.key === backward) delta = -KEY_STEP;
    else return;
    e.preventDefault();
    onResize(delta);
    onResizeEnd?.();
  }
</script>

<!-- A focusable separator is the ARIA "window splitter" pattern: it carries
     role="separator" + tabindex and is operated with the arrow keys (#817).
     Svelte's a11y lint treats a separator as non-interactive, so the
     tabindex + keyboard/pointer listeners are intentional here. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="resize-handle {direction}"
  class:dragging
  role="separator"
  tabindex="0"
  aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
  aria-label="Resize split panes (use arrow keys)"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onkeydown={onKeydown}
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
  /* Keyboard focus: the 1px bar is easy to miss, so widen the accent hit. */
  .resize-handle:focus-visible {
    background-color: var(--accent);
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
</style>
