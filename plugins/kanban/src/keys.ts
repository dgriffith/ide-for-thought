/**
 * The menu key, and opening an element's menu from the keyboard — the board's
 * copy of `type-view/note-actions.ts`'s two helpers (a plugin can't import the
 * renderer, #2828).
 */

/** Shift+F10 or the ContextMenu key: open the focused card's menu (#2776). */
export function isMenuKey(e: KeyboardEvent): boolean {
  return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey);
}

/** Open an element's context menu from the keyboard: the same `contextmenu`
 *  event a right-click sends, placed at the element, so it takes the same route. */
export function openMenuAt(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: r.left + Math.min(24, r.width / 2), clientY: r.bottom - 4,
  }));
}
