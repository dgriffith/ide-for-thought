/**
 * Moving and resizing a timed event by pointer in the Week and Day grids
 * (#2953, epic #2949) — the grid-side input; the write is the host's
 * (`view.retime` / `view.resize` → the `kanban-moves` store), the rule
 * `date-shift.ts`'s `retimeByMinutes` / `resizeByMinutes`.
 *
 * Pointer events, as the month grid's `event-drag.ts` (native drag-and-drop
 * suspends the renderer on macOS Electron). `timeDrag` is an action on the
 * time grid:
 *
 * - A primary-button press on a timed event (`.wk-ev`) arms a **move**; on its
 *   bottom edge (`[data-resize-handle]`) a **resize**. The grab point is the
 *   minute under the pointer, read from the half-hour cell it's in. Nothing
 *   happens until the pointer travels `DRAG_THRESHOLD_PX`, so a click still
 *   opens the note.
 * - While dragging, the edge that moves (a move's start, a resize's end)
 *   follows the pointer and lands on a multiple of `SNAP_MINUTES` — the
 *   event's edge snaps, not the pointer, so a 9:10 event dragged down lands on
 *   9:30, not 9:40. The event is drawn where it would land: moved (by a CSS translate,
 *   across days in a week) or stretched. `data-drop-time` on it says the
 *   landing time, for `aria-hidden` sighted feedback only — the host
 *   announces the result.
 * - Release asks `onMove(path, minutes)` — how far the start moved, on the
 *   civil axis, so another day adds 1440 a day — or `onResize(path,
 *   minutes)`, how far the end moved. A zero delta, Escape, or a cancelled pointer
 *   asks nothing. The click after a drag is swallowed.
 * - **A refused event** (`refusal(path, kind)` gives the sentence) doesn't
 *   drag: crossing the threshold calls `onRefused` once.
 * - **The hover preview goes** while dragging (`onDragStart` / `onDragEnd`).
 *   It's drawn by the app over the frame, so a pointer that reaches it is
 *   the app's, not the frame's: the rest of the drag — the release included
 *   — would never arrive.
 */
import type { Action } from 'svelte/action';
import { DAY_MS } from '../../../src/shared/time';
import { DRAG_THRESHOLD_PX } from './drag-keys';

/** What a drag snaps to, in minutes. */
export const SNAP_MINUTES = 15;
const SLOT_MINUTES = 30;

export type TimeDragKind = 'move' | 'resize';

/** What moving by time asks of the calendar (#2953): `Calendar.svelte` gives it to `CalendarWeek`. */
export interface TimeMoves {
  /** Why this event can't be moved or resized, or null. */
  refusal: (key: string, kind: TimeDragKind) => string | null;
  /** The landing time's text for a drag's preview. */
  previewText: (key: string, kind: TimeDragKind, minutes: number) => string | null;
  move: (key: string, minutes: number) => void;
  resize: (key: string, minutes: number) => void;
  /** Speak a refusal. */
  refused: (text: string) => void;
}

export interface TimeDragOptions {
  /** False (an embed, an export, choosing a day): nothing drags. */
  enabled: boolean;
  /** Pixels per minute, to draw the preview. */
  pxPerMinute: number;
  /** Why this event can't be moved or resized (spoken), or null when it can. */
  refusal: (path: string, kind: TimeDragKind) => string | null;
  /** The landing time's text, for the preview: a move's new start or a resize's new end, `minutes` on. */
  previewText: (path: string, kind: TimeDragKind, minutes: number) => string | null;
  onMove: (path: string, minutes: number) => void;
  onResize: (path: string, minutes: number) => void;
  onRefused: (path: string, text: string) => void;
  /** A drag began (past the threshold, not refused), and ended either way. */
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/** A point on the grid: its day (civil ms) and minute past midnight. */
export interface GridPoint {
  day: number;
  minute: number;
}

/** Snap a minute to the nearest `SNAP_MINUTES`. */
export function snapMinute(minute: number): number {
  return Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES;
}

/** The pointer's travel between two grid points on the civil axis, in minutes (unsnapped). */
export function minutesBetween(from: GridPoint, to: GridPoint): number {
  return Math.round((to.day - from.day) / DAY_MS) * 1440 + to.minute - from.minute;
}

/** How far an edge at `edge` minutes moves for a pointer travel of `travel`: to the nearest snap. */
export function snappedMove(edge: number, travel: number): number {
  return snapMinute(edge + travel) - edge;
}

/** The half-hour cell (`[data-slot]` ≥ 0) of `grid` under the point, and the minute there, by geometry. */
export function pointAt(grid: HTMLElement, x: number, y: number): (GridPoint & { cell: HTMLElement }) | null {
  for (const cell of grid.querySelectorAll<HTMLElement>('[role="gridcell"][data-day][data-slot]')) {
    const slot = Number(cell.dataset['slot']);
    if (slot < 0) continue;
    const r = cell.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
      return { cell, day: Number(cell.dataset['day']), minute: slot * SLOT_MINUTES + ((y - r.top) / r.height) * SLOT_MINUTES };
    }
  }
  return null;
}

interface Drag {
  pointerId: number;
  kind: TimeDragKind;
  event: HTMLElement;
  path: string;
  grab: GridPoint & { cell: HTMLElement };
  startX: number;
  startY: number;
  started: boolean;
  refused: boolean;
  /** The moving edge, in minutes past the grabbed piece's midnight: its start, or (a resize) its end. */
  edge: number;
  minutes: number;
  height: string;
}

export const timeDrag: Action<HTMLElement, TimeDragOptions> = (grid, initial) => {
  let opts = initial;
  let drag: Drag | null = null;
  let swallowClick = false;
  let savedUserSelect = '';

  function draw(d: Drag, over: (GridPoint & { cell: HTMLElement }) | null): void {
    if (!over) return;
    d.minutes = snappedMove(d.edge, minutesBetween(d.grab, over));
    if (d.kind === 'move') {
      const dx = over.cell.getBoundingClientRect().left - d.grab.cell.getBoundingClientRect().left;
      const days = Math.round((over.day - d.grab.day) / DAY_MS);
      const dy = (d.minutes - days * 1440) * opts.pxPerMinute;
      d.event.style.transform = `translate(${dx}px, ${dy}px)`;
    } else {
      const h = parseFloat(d.height) || 0;
      d.event.style.height = `${Math.max(8, h + d.minutes * opts.pxPerMinute)}px`;
    }
    const text = d.minutes === 0 ? null : opts.previewText(d.path, d.kind, d.minutes);
    if (text) d.event.setAttribute('data-drop-time', text);
    else d.event.removeAttribute('data-drop-time');
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
    setTimeout(() => { swallowClick = false; }, 0);
    d.event.style.transform = '';
    d.event.style.height = d.height;
    d.event.removeAttribute('data-dragging');
    d.event.removeAttribute('data-drop-time');
    document.body.style.userSelect = savedUserSelect;
    if (!d.refused) opts.onDragEnd?.();
    if (!commit || d.refused || d.minutes === 0) return;
    if (d.kind === 'move') opts.onMove(d.path, d.minutes);
    else opts.onResize(d.path, d.minutes);
  }

  function onMove(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId || d.refused) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.started = true;
      const refusal = opts.refusal(d.path, d.kind);
      if (refusal !== null) {
        d.refused = true;
        opts.onRefused(d.path, refusal);
        return;
      }
      opts.onDragStart?.();
      d.event.setAttribute('data-dragging', d.kind);
      savedUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
    }
    e.preventDefault();
    draw(d, pointAt(grid, e.clientX, e.clientY));
  }

  function onUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.started && !drag.refused) draw(drag, pointAt(grid, e.clientX, e.clientY));
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
    const target = e.target as HTMLElement | null;
    const event = target?.closest<HTMLElement>('.wk-ev[data-calendar-event]');
    const path = event?.dataset['notePath'];
    if (!event || !path || !grid.contains(event)) return;
    const grab = pointAt(grid, e.clientX, e.clientY);
    if (!grab) return;
    const kind: TimeDragKind = target?.closest('[data-resize-handle]') ? 'resize' : 'move';
    const edge = Number(event.dataset[kind === 'move' ? 'startMin' : 'endMin']);
    if (!Number.isFinite(edge)) return;
    drag = {
      pointerId: e.pointerId, kind, event, path, grab,
      startX: e.clientX, startY: e.clientY, started: false, refused: false, edge, minutes: 0, height: event.style.height,
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

  grid.addEventListener('pointerdown', onDown);
  grid.addEventListener('click', onClick, true);
  return {
    update(next) { opts = next; if (!next.enabled) end(false); },
    destroy() {
      end(false);
      grid.removeEventListener('pointerdown', onDown);
      grid.removeEventListener('click', onClick, true);
    },
  };
};
