/**
 * Rescheduling a Calendar event by pointer (#2703, epic #2699) — the grid-side
 * input. The write is the host's (`onDrop` → the `kanban-moves` store's
 * `rescheduleEvent`); the rule is `shared/objects/date-shift.ts`'s.
 *
 * **Pointer events, not HTML5 drag-and-drop**, as Kanban's `card-drag.ts`:
 * native DnD suspends the renderer's reactivity loop on macOS Electron, so a
 * drop preview created on `dragstart` never paints. `eventDrag` is a Svelte
 * action on the grid:
 *
 * - A primary-button press on an event (`[data-calendar-event]`) arms a drag,
 *   remembering the **grab day** — the day cell under the pointer, so a press
 *   on the third day of a bar grabs that day. It starts once the pointer
 *   travels `DRAG_THRESHOLD_PX`, so a click still opens the note.
 * - While dragging, a ghost of the event follows the pointer, every segment
 *   of the event carries `data-dragging`, and the day cells the event would
 *   cover after the drop carry `data-drop-target` (the whole event moves by
 *   `dropDay − grabDay`, whichever segment was grabbed).
 * - Release over a day cell other than the grab day calls `onDrop(path,
 *   days)`; release elsewhere, Escape, or a cancelled pointer drops nothing.
 *   The click the browser fires after a drag is swallowed.
 * - **A refused event** (`refusal(path)` returns the sentence — a start or
 *   end that is only a month or a year) doesn't drag: crossing the threshold
 *   calls `onRefused` once, which speaks why; nothing follows the pointer and
 *   the release doesn't open the note.
 */
import type { Action } from 'svelte/action';
import { DAY_MS } from '../../../../shared/time';
import { DRAG_THRESHOLD_PX } from '../kanban/card-drag';

export interface EventDragOptions {
  /** False (an embed, an export): events don't drag. */
  enabled: boolean;
  /** Why this event can't be rescheduled (spoken), or null when it can. */
  refusal: (path: string) => string | null;
  /** The civil days the event covers, for the drop preview; null when unknown. */
  coverage: (path: string) => { first: number; last: number } | null;
  onDragStart?: () => void;
  /** Move the event by `days` whole days. */
  onDrop: (path: string, days: number) => void;
  onRefused: (path: string, text: string) => void;
}

interface Drag {
  pointerId: number;
  event: HTMLElement;
  path: string;
  grabDay: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  started: boolean;
  refused: boolean;
  ghost: HTMLElement | null;
  overDay: number | null;
}

/** The day cell (`[data-day]`) of `grid` under the point, by geometry: an
 *  event bar is drawn over the cells it spans, so hit-testing finds the bar. */
export function dayAt(grid: HTMLElement, x: number, y: number): number | null {
  for (const cell of grid.querySelectorAll<HTMLElement>('[data-day]')) {
    const r = cell.getBoundingClientRect();
    if (r.width > 0 && x >= r.left && x < r.right && y >= r.top && y < r.bottom) return Number(cell.dataset['day']);
  }
  return null;
}

function makeGhost(source: HTMLElement): HTMLElement {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  for (const a of ['data-calendar-event', 'data-dragging', 'data-note-path', 'aria-describedby']) ghost.removeAttribute(a);
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('data-calendar-ghost', '');
  ghost.tabIndex = -1;
  Object.assign(ghost.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${Math.max(rect.width, 60)}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '1000',
    opacity: '0.92',
    background: 'var(--bg-button)',
    color: 'var(--text)',
    border: '1px solid var(--accent)',
    borderLeft: '3px solid var(--accent)',
    boxShadow: '0 8px 24px color-mix(in oklch, var(--bg) 40%, transparent)',
  });
  return ghost;
}

export const eventDrag: Action<HTMLElement, EventDragOptions> = (grid, initial) => {
  let opts = initial;
  let drag: Drag | null = null;
  let swallowClick = false;
  let savedUserSelect = '';

  const segmentsOf = (path: string) => [...grid.querySelectorAll<HTMLElement>('[data-calendar-event]')].filter((el) => el.dataset['notePath'] === path);

  function clearPreview(): void {
    for (const el of grid.querySelectorAll('[data-drop-target]')) el.removeAttribute('data-drop-target');
  }

  function setOver(day: number | null): void {
    if (!drag || drag.overDay === day) return;
    drag.overDay = day;
    clearPreview();
    if (day === null || day === drag.grabDay) return;
    const cover = opts.coverage(drag.path) ?? { first: drag.grabDay, last: drag.grabDay };
    const shift = day - drag.grabDay;
    for (const cell of grid.querySelectorAll<HTMLElement>('[data-day]')) {
      const d = Number(cell.dataset['day']);
      if (d >= cover.first + shift && d <= cover.last + shift) cell.setAttribute('data-drop-target', '');
    }
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
    // A click follows the pointerup on the same event; if none comes
    // (released elsewhere), stop swallowing on the next turn.
    setTimeout(() => { swallowClick = false; }, 0);
    d.ghost?.remove();
    for (const el of segmentsOf(d.path)) el.removeAttribute('data-dragging');
    clearPreview();
    document.body.style.userSelect = savedUserSelect;
    if (commit && !d.refused && d.overDay !== null && d.overDay !== d.grabDay) {
      opts.onDrop(d.path, Math.round((d.overDay - d.grabDay) / DAY_MS));
    }
  }

  function onMove(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId || d.refused) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.started = true;
      const refusal = opts.refusal(d.path);
      if (refusal !== null) {
        d.refused = true;
        opts.onRefused(d.path, refusal); // held until release, so the release doesn't open the note
        return;
      }
      opts.onDragStart?.();
      d.ghost = makeGhost(d.event);
      document.body.appendChild(d.ghost);
      for (const el of segmentsOf(d.path)) el.setAttribute('data-dragging', '');
      savedUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
    }
    e.preventDefault();
    if (d.ghost) d.ghost.style.transform = `translate(${e.clientX - d.offsetX}px, ${e.clientY - d.offsetY}px)`;
    setOver(dayAt(grid, e.clientX, e.clientY));
  }

  function onUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.started && !drag.refused) setOver(dayAt(grid, e.clientX, e.clientY));
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
    const event = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-calendar-event]');
    const path = event?.dataset['notePath'];
    if (!event || !path || !grid.contains(event)) return;
    // The day under the pointer; without layout (or off every cell), the cell the segment starts in.
    const grabDay = dayAt(grid, e.clientX, e.clientY) ?? Number(event.closest<HTMLElement>('[data-day]')?.dataset['day'] ?? NaN);
    if (!Number.isFinite(grabDay)) return;
    const rect = event.getBoundingClientRect();
    drag = {
      pointerId: e.pointerId, event, path, grabDay,
      startX: e.clientX, startY: e.clientY,
      offsetX: Math.min(e.clientX - rect.left, 40), offsetY: e.clientY - rect.top,
      started: false, refused: false, ghost: null, overDay: null,
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
