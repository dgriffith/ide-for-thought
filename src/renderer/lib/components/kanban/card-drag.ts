/**
 * Moving a Kanban card (#2603, epic #2600) — the board-side input: pointer
 * drag between columns, and the keys that reach the same move.
 *
 * **Pointer events, not HTML5 drag-and-drop.** Native DnD suspends the
 * renderer's reactivity loop on macOS Electron, so a drop overlay created on
 * `dragstart` never paints. `cardDrag` is a Svelte action on the board:
 *
 * - A primary-button press on a card (`[data-kanban-card]`) arms a drag; it
 *   starts once the pointer travels `DRAG_THRESHOLD_PX`, so a click is still a
 *   click. While dragging, a ghost of the card follows the pointer, the source
 *   card carries `data-dragging`, and the column under the pointer
 *   (`section.kb-column`, identified by `data-column-value` /
 *   `data-column-kind`) carries `data-drop-target`. The board styles both
 *   with theme tokens; the ghost is styled inline from the same tokens.
 * - Release over a different column calls `onDrop(path, target)`; release
 *   anywhere else, Escape, or a cancelled pointer drops nothing. The click
 *   the browser fires after a drag is swallowed, so a drop never opens the
 *   note. Near the board's edge the board scrolls, so a far column is
 *   reachable on a narrow window.
 *
 * **Keys** (`cardMoveKey`): Shift+F10 or the ContextMenu key opens the card's
 * menu (*Move to ▸* and *Edit Properties…*), the platform convention for
 * "the context menu, from the keyboard"; ⌘Z (Ctrl+Z) undoes the last move.
 */
import type { Action } from 'svelte/action';
import { targetOfColumn, type MoveTarget } from '../../../../shared/objects/kanban-move';

export const DRAG_THRESHOLD_PX = 5;
/** How close to the board's edge (px) the pointer must be to scroll it. */
const EDGE_PX = 40;
const EDGE_STEP_PX = 16;

export interface CardDragOptions {
  /** False (an embed, an export): cards don't drag. */
  enabled: boolean;
  onDrop: (path: string, target: MoveTarget) => void;
}

interface Drag {
  pointerId: number;
  card: HTMLElement;
  path: string;
  fromColumn: HTMLElement | null;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  started: boolean;
  ghost: HTMLElement | null;
  over: HTMLElement | null;
}

function columnAt(board: HTMLElement, x: number, y: number): HTMLElement | null {
  const hit = document.elementFromPoint?.(x, y) as HTMLElement | null | undefined;
  const col = hit?.closest<HTMLElement>('section.kb-column') ?? null;
  return col && board.contains(col) ? col : null;
}

function makeGhost(card: HTMLElement): HTMLElement {
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('data-kanban-card');
  ghost.removeAttribute('data-dragging');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('data-kanban-ghost', '');
  ghost.tabIndex = -1;
  Object.assign(ghost.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${rect.width}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '1000',
    opacity: '0.92',
    background: 'var(--bg-button)',
    color: 'var(--text)',
    border: '1px solid var(--accent)',
    borderRadius: '6px',
    boxShadow: '0 8px 24px color-mix(in oklch, var(--bg) 40%, transparent)',
    transform: 'rotate(1.5deg)',
  });
  return ghost;
}

export const cardDrag: Action<HTMLElement, CardDragOptions> = (board, initial) => {
  let opts = initial;
  let drag: Drag | null = null;
  let swallowClick = false;
  let savedUserSelect = '';

  function setOver(col: HTMLElement | null): void {
    if (!drag || drag.over === col) return;
    drag.over?.removeAttribute('data-drop-target');
    drag.over = col && col !== drag.fromColumn ? col : null;
    drag.over?.setAttribute('data-drop-target', '');
  }

  function end(commit: boolean): void {
    const d = drag;
    if (!d) return;
    drag = null;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    if (!d.started) return;
    swallowClick = true;
    // A click follows the pointerup on the same card; if none comes (released
    // elsewhere), stop swallowing on the next turn.
    setTimeout(() => { swallowClick = false; }, 0);
    d.ghost?.remove();
    d.card.removeAttribute('data-dragging');
    d.over?.removeAttribute('data-drop-target');
    document.body.style.userSelect = savedUserSelect;
    if (commit && d.over) {
      opts.onDrop(d.path, targetOfColumn(d.over.dataset['columnValue'] ?? '', d.over.dataset['columnKind'] ?? ''));
    }
  }

  function edgeScroll(x: number, y: number): void {
    const r = board.getBoundingClientRect();
    if (x < r.left + EDGE_PX) board.scrollLeft -= EDGE_STEP_PX;
    else if (x > r.right - EDGE_PX) board.scrollLeft += EDGE_STEP_PX;
    if (y < r.top + EDGE_PX) board.scrollTop -= EDGE_STEP_PX;
    else if (y > r.bottom - EDGE_PX) board.scrollTop += EDGE_STEP_PX;
  }

  function onMove(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.started = true;
      d.ghost = makeGhost(d.card);
      document.body.appendChild(d.ghost);
      d.card.setAttribute('data-dragging', '');
      savedUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
    }
    e.preventDefault();
    if (d.ghost) d.ghost.style.transform = `translate(${e.clientX - d.offsetX}px, ${e.clientY - d.offsetY}px) rotate(1.5deg)`;
    edgeScroll(e.clientX, e.clientY);
    setOver(columnAt(board, e.clientX, e.clientY));
  }

  function onUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.started) setOver(columnAt(board, e.clientX, e.clientY));
    end(true);
  }
  function onCancel(): void { end(false); }
  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !drag?.started) return;
    e.preventDefault();
    e.stopPropagation();
    end(false);
  }

  function onDown(e: PointerEvent): void {
    if (!opts.enabled || drag || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-kanban-card]');
    const path = card?.dataset['notePath'];
    if (!card || !path || !board.contains(card)) return;
    const rect = card.getBoundingClientRect();
    drag = {
      pointerId: e.pointerId, card, path,
      fromColumn: card.closest<HTMLElement>('section.kb-column'),
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      started: false, ghost: null, over: null,
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
  }

  function onClick(e: MouseEvent): void {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }

  board.addEventListener('pointerdown', onDown);
  board.addEventListener('click', onClick, true);
  return {
    update(next) { opts = next; if (!next.enabled) end(false); },
    destroy() {
      end(false);
      board.removeEventListener('pointerdown', onDown);
      board.removeEventListener('click', onClick, true);
    },
  };
};

/** What a keydown on a card asks of the move feature, if anything. */
export function cardMoveKey(e: KeyboardEvent): 'menu' | 'undo' | null {
  if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey)) return 'menu';
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') return 'undo';
  return null;
}

/** Open a card's context menu from the keyboard: the same `contextmenu` event
 *  a right-click sends, placed at the card, so it takes the same route. */
export function openCardMenu(card: HTMLElement): void {
  const r = card.getBoundingClientRect();
  card.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: r.left + Math.min(24, r.width / 2), clientY: r.bottom - 4,
  }));
}
