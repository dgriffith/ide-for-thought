/**
 * Reordering a Kanban board's columns by dragging a header (#2614, epic
 * #2600). Its own module so the board component only wires it onto
 * `.kb-col-header`: card dragging (#2603) lives beside it, not in it.
 *
 * - **Pointer events, not HTML5 drag-and-drop**, which is unreliable in
 *   Electron on macOS (the native drag suspends the renderer's reactivity
 *   loop). A press on the header becomes a drag past `DRAG_THRESHOLD_PX`, so a
 *   click stays a click; a press on a button inside the header (its menu)
 *   never starts one.
 * - **Feedback** is two attributes the board styles with theme tokens: the
 *   dragged column carries `data-dragging`, and the column the drop lands
 *   beside carries `data-drop-side="before" | "after"`. A drop that wouldn't
 *   move anything shows no marker and does nothing. Escape, or a cancelled
 *   pointer, abandons the drag.
 * - **The drop** is reported as `(key, target, side)` — the dragged column's
 *   key, the visible column it lands beside, and which side — which is what
 *   `moveColumn` (`shared/objects/kanban.ts`) turns into the view's
 *   `columnOrder`. This module only ever reads the DOM; it writes no state.
 *
 * The keyboard path (*Move column left / right*, `KanbanColumnMenu.svelte`)
 * reports the same triple, and both end in `afterColumnMove`: announce the
 * new position through the app's live region and, for the keyboard, put
 * focus back on the moved column's header.
 */
import { tick } from 'svelte';
import { announce } from '../../stores/announcer.svelte';

export type DropSide = 'before' | 'after';

/** How far (px) a press must travel before it's a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 5;
/** Within this many px of the board's edge, a drag scrolls the board. */
const EDGE_SCROLL_PX = 40;
const EDGE_SCROLL_STEP = 16;

/** The header menu's button — the header's focus target. */
export const COLUMN_MENU_BUTTON = '.kb-col-menu-btn';

export interface ColumnDragOptions {
  /** The column's key (`columnKey`: its value, `""` for No value). */
  key: string;
  /** False in a read-only board (an embed, an export): no dragging. */
  enabled: boolean;
  onDrop: (key: string, target: string, side: DropSide) => void;
}

/** One planned drop: beside `target`, on `side`. */
export interface ColumnDrop { target: string; side: DropSide }

function columnKeyOf(col: Element): string {
  return (col as HTMLElement).dataset['columnValue'] ?? '';
}

/**
 * Where a drag of column `dragIndex` ends when the pointer is at `x`, given
 * each visible column's left/right edges in board order — or null when it
 * would land where it already is. Pure, so the geometry is unit-testable.
 */
export function planColumnDrop(
  rects: readonly { left: number; right: number; key: string }[],
  dragIndex: number,
  x: number,
): ColumnDrop | null {
  if (rects.length < 2 || dragIndex < 0) return null;
  let slot = rects.findIndex((r) => x < (r.left + r.right) / 2);
  if (slot === -1) slot = rects.length;
  if (slot === dragIndex || slot === dragIndex + 1) return null;
  return slot < rects.length ? { target: rects[slot]!.key, side: 'before' } : { target: rects[rects.length - 1]!.key, side: 'after' };
}

/**
 * A Svelte action for a column header: drag it to reorder the board's
 * columns. `use:columnDrag={{ key, enabled, onDrop }}`.
 */
export function columnDrag(node: HTMLElement, initial: ColumnDragOptions) {
  let opts = initial;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let drop: ColumnDrop | null = null;
  let column: HTMLElement | null = null;
  let board: HTMLElement | null = null;

  const columns = (): HTMLElement[] => [...(board?.querySelectorAll<HTMLElement>('.kb-column') ?? [])];
  function clearMarkers(): void {
    for (const c of columns()) delete c.dataset['dropSide'];
  }
  function reset(): void {
    clearMarkers();
    if (column) delete column.dataset['dragging'];
    if (board) delete board.dataset['columnDragging'];
    if (pointerId !== null && node.hasPointerCapture?.(pointerId)) node.releasePointerCapture(pointerId);
    pointerId = null;
    dragging = false;
    drop = null;
    column = null;
    board = null;
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', onUp);
    node.removeEventListener('pointercancel', reset);
    window.removeEventListener('keydown', onKey, true);
  }

  function onDown(e: PointerEvent): void {
    if (!opts.enabled || e.button !== 0 || !e.isPrimary || pointerId !== null) return;
    if ((e.target as Element | null)?.closest('button, a, input, select')) return;
    column = node.closest<HTMLElement>('.kb-column');
    board = node.closest<HTMLElement>('.kb-board');
    if (!column || !board) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    node.setPointerCapture?.(e.pointerId);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', reset);
    window.addEventListener('keydown', onKey, true);
  }

  function onMove(e: PointerEvent): void {
    if (e.pointerId !== pointerId || !column || !board) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      column.dataset['dragging'] = '';
      board.dataset['columnDragging'] = '';
    }
    e.preventDefault(); // no text selection while dragging
    const box = board.getBoundingClientRect();
    if (e.clientX < box.left + EDGE_SCROLL_PX) board.scrollLeft -= EDGE_SCROLL_STEP;
    else if (e.clientX > box.right - EDGE_SCROLL_PX) board.scrollLeft += EDGE_SCROLL_STEP;
    const cols = columns();
    const rects = cols.map((c) => {
      const r = c.getBoundingClientRect();
      return { left: r.left, right: r.right, key: columnKeyOf(c) };
    });
    drop = planColumnDrop(rects, cols.indexOf(column), e.clientX);
    clearMarkers();
    if (drop) {
      const target = cols.find((c) => columnKeyOf(c) === drop!.target);
      if (target) target.dataset['dropSide'] = drop.side;
    }
  }

  function onUp(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    const planned = dragging ? drop : null;
    const wasDragging = dragging;
    reset();
    if (wasDragging) {
      // The click a drag ends with isn't a click on whatever is under it. It
      // arrives right after pointerup; the timer stops a click that never
      // comes from swallowing the next real one.
      window.addEventListener('click', swallowClick, true);
      setTimeout(() => window.removeEventListener('click', swallowClick, true), 0);
    }
    if (planned) opts.onDrop(opts.key, planned.target, planned.side);
  }
  function swallowClick(c: MouseEvent): void {
    c.stopPropagation();
    c.preventDefault();
    window.removeEventListener('click', swallowClick, true);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    reset();
  }

  node.addEventListener('pointerdown', onDown);
  if (opts.enabled) node.dataset['draggable'] = '';
  return {
    update(next: ColumnDragOptions): void {
      opts = next;
      if (next.enabled) node.dataset['draggable'] = '';
      else delete node.dataset['draggable'];
    },
    destroy(): void {
      reset();
      node.removeEventListener('pointerdown', onDown);
    },
  };
}

/** The visible columns' keys and labels, in board order. */
function boardColumnsOf(board: HTMLElement): HTMLElement[] {
  return [...board.querySelectorAll<HTMLElement>('.kb-column')];
}

/**
 * After a move has been handed to the view: once the board re-renders,
 * announce where the column now is and, for a keyboard move, focus its
 * header's menu button (a moved DOM node loses focus).
 */
export async function afterColumnMove(getBoard: () => HTMLElement | undefined, key: string, label: string, opts: { focus: boolean }): Promise<void> {
  await tick();
  const board = getBoard(); // read after the re-render, which may have replaced it
  if (!board) return;
  const cols = boardColumnsOf(board);
  const index = cols.findIndex((c) => columnKeyOf(c) === key);
  if (index === -1) return;
  announce(`Moved ${label} column to position ${index + 1} of ${cols.length}`);
  if (opts.focus) cols[index]!.querySelector<HTMLElement>(COLUMN_MENU_BUTTON)?.focus();
}

/**
 * Keyboard movement along the board's header row (#2614): ←/→ to the
 * neighbouring column's header, Home/End to the first/last, ↓ to the
 * column's first card. ↑ from a column's first card comes up here (wired in
 * the board's own card navigation). Returns true when it handled the key.
 */
export function headerKeydown(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  const btn = e.currentTarget as HTMLElement;
  const board = btn.closest<HTMLElement>('.kb-board');
  const column = btn.closest<HTMLElement>('.kb-column');
  if (!board || !column) return false;
  const buttons = boardColumnsOf(board).map((c) => c.querySelector<HTMLElement>(COLUMN_MENU_BUTTON)).filter((b): b is HTMLElement => !!b);
  const i = buttons.indexOf(btn);
  let next: HTMLElement | null | undefined;
  if (e.key === 'ArrowLeft') next = buttons[i - 1];
  else if (e.key === 'ArrowRight') next = buttons[i + 1];
  else if (e.key === 'Home') next = buttons[0];
  else if (e.key === 'End') next = buttons[buttons.length - 1];
  else if (e.key === 'ArrowDown') next = column.querySelector<HTMLElement>('[data-kanban-card]');
  else return false;
  e.preventDefault();
  next?.focus();
  return true;
}

/** Focus column `columnEl`'s header menu button (↑ from its first card). */
export function focusColumnHeader(columnEl: Element | null | undefined): boolean {
  const btn = columnEl?.querySelector<HTMLElement>(COLUMN_MENU_BUTTON);
  btn?.focus();
  return !!btn;
}
