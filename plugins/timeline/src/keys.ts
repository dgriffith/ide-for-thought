/**
 * The menu key, and opening an element's menu from the keyboard — the
 * timeline's copy of Kanban's `keys.ts` (a plugin can't import another, or
 * the renderer, #2828). An element, not an `HTMLElement`: an event is an SVG
 * `<g>`.
 */

/** Shift+F10 or the ContextMenu key: open the focused event's menu (#2776). */
export function isMenuKey(e: KeyboardEvent): boolean {
  return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey);
}

/** Open an element's context menu from the keyboard: the same `contextmenu`
 *  event a right-click sends, placed at the element, so it takes the same route. */
export function openMenuAt(el: Element): void {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: r.left + Math.min(24, r.width / 2), clientY: r.bottom - 4,
  }));
}
