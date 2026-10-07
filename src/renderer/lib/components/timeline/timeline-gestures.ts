/**
 * The Timeline's pointer gestures (#2608), as a Svelte action on its
 * viewport: **wheel or pinch to zoom** about the pointer, a horizontal wheel
 * (or Shift+wheel) to pan, and **drag to pan** — sideways through time, up
 * and down through the lanes.
 *
 * Pointer events throughout, not HTML5 drag-and-drop, which suspends the
 * reactivity loop in macOS Electron (the same reason `kanban/card-drag.ts` is
 * built this way). A drag starts after `DRAG_THRESHOLD_PX` of travel, so a
 * click on an event still opens it; the click that ends a real drag is
 * swallowed. The pointer is captured only once a drag starts — capturing on
 * pointerdown would retarget that click to the viewport.
 *
 * A trackpad pinch arrives in Chromium as a wheel event with `ctrlKey` set, so
 * the wheel handler is the pinch handler too. The listener is non-passive: it
 * must `preventDefault` to stop the page scrolling under a zoom. Disabled (a
 * read-only embed), it does nothing and the page scrolls as normal.
 *
 * Every gesture reports its domain as it goes (`onDomain`) and says when it
 * has settled (`onSettle`): drag on release, wheel after `WHEEL_SETTLE_MS`
 * of quiet — the host writes the range back then, not per frame.
 */
import { panDomain, zoomDomain, type Domain } from './timeline-scale';

export const DRAG_THRESHOLD_PX = 4;
export const WHEEL_SETTLE_MS = 350;

export interface GestureOptions {
  enabled: boolean;
  /** The current domain and the drawing's width in px. */
  view: () => { domain: Domain; width: number } | null;
  onDomain: (d: Domain) => void;
  onSettle: () => void;
}

export function timelineGestures(node: HTMLElement, initial: GestureOptions) {
  let opts = initial;
  let drag: { id: number; x: number; y: number; domain: Domain; width: number; scrollTop: number; moving: boolean } | null = null;
  let swallowClick = false;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;

  function onPointerDown(e: PointerEvent): void {
    if (!opts.enabled || e.button !== 0 || !e.isPrimary) return;
    const v = opts.view();
    if (!v) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, domain: v.domain, width: v.width, scrollTop: node.scrollTop, moving: false };
  }
  function onPointerMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moving) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moving = true;
      node.setPointerCapture?.(e.pointerId);
      node.dataset['panning'] = '';
    }
    const msPerPx = (drag.domain.end - drag.domain.start) / drag.width;
    opts.onDomain(panDomain(drag.domain, -dx * msPerPx));
    node.scrollTop = drag.scrollTop - dy;
  }
  function onPointerUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moving;
    drag = null;
    delete node.dataset['panning'];
    if (moved) {
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
      opts.onSettle();
    }
  }
  function onClickCapture(e: MouseEvent): void {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }
  function onWheel(e: WheelEvent): void {
    if (!opts.enabled) return;
    const v = opts.view();
    if (!v) return;
    e.preventDefault();
    const msPerPx = (v.domain.end - v.domain.start) / v.width;
    const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (sideways) {
      opts.onDomain(panDomain(v.domain, (e.deltaX || e.deltaY) * msPerPx));
    } else {
      const rect = node.getBoundingClientRect();
      const anchor = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      opts.onDomain(zoomDomain(v.domain, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), anchor));
    }
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => opts.onSettle(), WHEEL_SETTLE_MS);
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerUp);
  node.addEventListener('click', onClickCapture, true);
  node.addEventListener('wheel', onWheel, { passive: false });
  return {
    update(next: GestureOptions) { opts = next; },
    destroy() {
      clearTimeout(wheelTimer);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerUp);
      node.removeEventListener('click', onClickCapture, true);
      node.removeEventListener('wheel', onWheel);
    },
  };
}
