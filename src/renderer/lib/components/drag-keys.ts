/**
 * What a pointer drag and a move key mean on a board-like surface — the
 * calendar's (#2703), which shared them with the in-app Kanban board until
 * Kanban became a plugin (#2828; its copy is `plugins/kanban/src/card-drag.ts`).
 */
import { isMenuKey } from './type-view/note-actions';

/** Travel (px) before a press becomes a drag, so a click stays a click. */
export const DRAG_THRESHOLD_PX = 5;

/** What a keydown on an item asks of the move feature: its menu (Shift+F10 /
 *  the ContextMenu key), an undo (⌘Z / Ctrl+Z), or nothing. */
export function cardMoveKey(e: KeyboardEvent): 'menu' | 'undo' | null {
  if (isMenuKey(e)) return 'menu';
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') return 'undo';
  return null;
}
