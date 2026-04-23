/**
 * Keep a floating context menu inside the viewport.
 *
 * The Electron title-bar menus are native and the OS handles edge
 * avoidance. Our in-app menus (sidebar file tree, tab right-click,
 * tables, bookmarks, editor content + gutter) are custom HTML divs —
 * so clicking near the bottom-right corner of the window will run them
 * off-screen unless we nudge them back. Each call site drives a
 * $effect that measures the menu's bounding box and clamps the
 * originating pointer coordinates to keep the menu in-bounds with an
 * 8px margin.
 *
 * Usage:
 *   $effect(() => {
 *     if (!contextMenu || !menuEl) return;
 *     const next = clampMenuToViewport(contextMenu.x, contextMenu.y, menuEl);
 *     if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
 *       contextMenu = { ...contextMenu, ...next };
 *     }
 *   });
 */
export function clampMenuToViewport(
  x: number,
  y: number,
  el: HTMLElement,
): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const MARGIN = 8;
  let nextX = x;
  let nextY = y;
  if (rect.bottom > vh - MARGIN) {
    nextY = Math.max(MARGIN, vh - rect.height - MARGIN);
  }
  if (rect.right > vw - MARGIN) {
    nextX = Math.max(MARGIN, vw - rect.width - MARGIN);
  }
  return { x: nextX, y: nextY };
}
