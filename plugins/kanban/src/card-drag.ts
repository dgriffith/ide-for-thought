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
 * - **Where in the column** (#2922): the drop lands between the two cards the
 *   pointer is between — the card whose middle is first below it, or after
 *   the column's last card. That card carries `data-drop-before` /
 *   `data-drop-after` (a line the board draws). A drop in the card's own
 *   column reorders it; a drop on the spot it already holds does nothing.
 * - Release calls `onDrop(path, target, anchor)`: `target` is the column
 *   when it is a different one (null in the card's own), `anchor` the card it
 *   lands beside (null in an empty column, or where `canReorder` is off).
 *   Release anywhere else, Escape, or a cancelled pointer drops nothing. The click
 *   the browser fires after a drag is swallowed, so a drop never opens the
 *   note. Near the board's edge the board scrolls, so a far column is
 *   reachable on a narrow window.
 *
 * **Keys** (`cardMoveKey`): Shift+F10 or the ContextMenu key opens the card's
 * menu (*Move to ▸* and *Edit Properties…*), the platform convention for
 * "the context menu, from the keyboard"; ⌘Z (Ctrl+Z) undoes the last move.
 */
import type { Action } from 'svelte/action';
import { targetOfColumn, type MoveTarget } from '../../../src/shared/objects/kanban-move';
import { isMenuKey, openMenuAt } from './keys';

export const DRAG_THRESHOLD_PX = 5;
/** How close to the board's edge (px) the pointer must be to scroll it. */
const EDGE_PX = 40;
const EDGE_STEP_PX = 16;

/** The card a dropped card lands beside (#2922). */
export interface DropAnchor { path: string; side: 'before' | 'after' }

export interface CardDragOptions {
  /** False (an embed, an export): cards don't drag. */
  enabled: boolean;
  /** Cards can change column (`view.moveCard`). Off: only their own column takes a drop. */
  canMove?: boolean;
  /** Cards can be put in order (`view.reorderCard`). Off: a drop has no anchor. */
  canReorder?: boolean;
  /**
   * `target`: the column, when it isn't the card's own; `column`: the column
   * dropped in, own or not — a selection dragged together (#2941) brings its
   * other cards there even when the dragged one stays.
   */
  onDrop: (path: string, target: MoveTarget | null, anchor: DropAnchor | null, column: MoveTarget) => void;
  /** How many cards a drag of `path` carries (#2941): a selection's size, shown on the ghost. */
  count?: (path: string) => number;
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
  /** The card the drop would land beside, and the element showing it. */
  anchor: DropAnchor | null;
  anchorEl: HTMLElement | null;
}

/** A column's cards, in the order drawn. */
function cardsOf(col: HTMLElement): HTMLElement[] {
  return [...col.querySelectorAll<HTMLElement>('[data-kanban-card]')];
}

/**
 * Where a card dragged to height `y` lands in `col` (#2922): beside the first
 * other card whose middle is below `y`, else after the last one. Null when
 * the column has no other card, or the spot is the one the card already holds.
 */
export function dropAnchorAt(col: HTMLElement, dragged: HTMLElement, y: number): { anchor: DropAnchor; el: HTMLElement } | null {
  const cards = cardsOf(col);
  const others = cards.filter((c) => c !== dragged);
  if (others.length === 0) return null;
  let at = others.findIndex((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2 > y; });
  if (at === -1) at = others.length;
  if (cards.indexOf(dragged) === at) return null; // where it already is
  const el = at < others.length ? others[at]! : others[others.length - 1]!;
  const path = el.dataset['notePath'];
  return path ? { anchor: { path, side: at < others.length ? 'before' : 'after' }, el } : null;
}

function columnAt(board: HTMLElement, x: number, y: number): HTMLElement | null {
  const hit = document.elementFromPoint?.(x, y) as HTMLElement | null | undefined;
  const col = hit?.closest<HTMLElement>('section.kb-column') ?? null;
  return col && board.contains(col) ? col : null;
}

function makeGhost(card: HTMLElement, count: number): HTMLElement {
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
  if (count > 1) {
    // A selection dragged together (#2941): how many cards come along.
    const badge = document.createElement('span');
    badge.setAttribute('data-kanban-ghost-count', '');
    badge.textContent = String(count);
    Object.assign(badge.style, {
      position: 'absolute', top: '-8px', right: '-8px', minWidth: '18px', height: '18px', padding: '0 5px',
      boxSizing: 'border-box', borderRadius: '9px', background: 'var(--accent)', color: 'var(--bg)',
      font: '600 11px/18px var(--font-sans)', textAlign: 'center',
    });
    ghost.appendChild(badge);
  }
  return ghost;
}

export const cardDrag: Action<HTMLElement, CardDragOptions> = (board, initial) => {
  let opts = initial;
  let drag: Drag | null = null;
  let swallowClick = false;
  let savedUserSelect = '';

  function setOver(col: HTMLElement | null, y: number): void {
    if (!drag) return;
    const own = col !== null && col === drag.fromColumn;
    const usable = col !== null && (own || opts.canMove !== false) ? col : null;
    if (drag.over !== usable) {
      drag.over?.removeAttribute('data-drop-target');
      drag.over = usable;
      if (usable && !own) usable.setAttribute('data-drop-target', '');
    }
    const at = usable && opts.canReorder !== false ? dropAnchorAt(usable, drag.card, y) : null;
    if (drag.anchorEl !== (at?.el ?? null) || drag.anchor?.side !== at?.anchor.side) {
      drag.anchorEl?.removeAttribute('data-drop-before');
      drag.anchorEl?.removeAttribute('data-drop-after');
      drag.anchorEl = at?.el ?? null;
      drag.anchorEl?.setAttribute(at!.anchor.side === 'before' ? 'data-drop-before' : 'data-drop-after', '');
    }
    drag.anchor = at?.anchor ?? null;
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
    d.anchorEl?.removeAttribute('data-drop-before');
    d.anchorEl?.removeAttribute('data-drop-after');
    document.body.style.userSelect = savedUserSelect;
    if (!commit || !d.over) return;
    const column = targetOfColumn(d.over.dataset['columnValue'] ?? '', d.over.dataset['columnKind'] ?? '');
    opts.onDrop(d.path, d.over === d.fromColumn ? null : column, d.anchor, column);
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
      d.ghost = makeGhost(d.card, opts.count?.(d.path) ?? 1);
      document.body.appendChild(d.ghost);
      d.card.setAttribute('data-dragging', '');
      savedUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
    }
    e.preventDefault();
    if (d.ghost) d.ghost.style.transform = `translate(${e.clientX - d.offsetX}px, ${e.clientY - d.offsetY}px) rotate(1.5deg)`;
    edgeScroll(e.clientX, e.clientY);
    setOver(columnAt(board, e.clientX, e.clientY), e.clientY);
  }

  function onUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.started) setOver(columnAt(board, e.clientX, e.clientY), e.clientY);
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
      started: false, ghost: null, over: null, anchor: null, anchorEl: null,
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
  if (isMenuKey(e)) return 'menu';
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') return 'undo';
  return null;
}

/** Open a card's context menu from the keyboard — `openMenuAt` (#2776). */
export const openCardMenu = openMenuAt;
