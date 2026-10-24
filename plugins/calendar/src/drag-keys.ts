/**
 * What a pointer drag and a move key mean on the calendar (#2703): its copy,
 * since it became a plugin (#2829), of what it shared with the in-app Kanban
 * board — whose own copy is `plugins/kanban/src/card-drag.ts` (a plugin can't
 * import the renderer, or another plugin).
 */

/** Shift+F10 or the ContextMenu key: open the focused item's menu (#2776). */
export function isMenuKey(e: KeyboardEvent): boolean {
  return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey);
}

/** Travel (px) before a press becomes a drag, so a click stays a click. */
export const DRAG_THRESHOLD_PX = 5;

/** What a keydown on an item asks of the move feature: its menu (Shift+F10 /
 *  the ContextMenu key), an undo (⌘Z / Ctrl+Z), or nothing. */
export function cardMoveKey(e: KeyboardEvent): 'menu' | 'undo' | null {
  if (isMenuKey(e)) return 'menu';
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') return 'undo';
  return null;
}
