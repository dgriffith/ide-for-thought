/**
 * Pointer-event drag to add a wiki-link (#1129).
 *
 * The polished half of drag-to-add-link: for panels that aren't HTML5-draggable
 * (Related, Backlinks, Sources), a `pointerdown` on an item starts a drag that
 * shows a floating ghost and a LIVE insertion-caret in the editor under the
 * pointer, dropping a resolving wiki-link on `pointerup`.
 *
 * Pointer events (not native HTML5 DnD) are deliberate: a macOS HTML5 drag
 * enters a nested run-loop that freezes renderer reactivity, so the live caret
 * overlay would never paint. This is the same lesson tab-drag learned (#817).
 *
 * The store finds the editor under the pointer via `EditorView.findFromDOM`, so
 * it needs no wiring back to App's per-pane editor component refs — panels just
 * import `getLinkDrag()` and call `start()`.
 */
import { EditorView } from '@codemirror/view';
import { type DraggedItem, wikiLinkForItem, insertWikiLinkAtPos } from '../editor/drag-link';

const DRAG_THRESHOLD = 5; // px before a press becomes a drag

let dragging = $state<DraggedItem | null>(null);
let ghost = $state<{ x: number; y: number } | null>(null);
let caret = $state<{ left: number; top: number; bottom: number } | null>(null);
// Pre-threshold press — plain (non-reactive) so a click that never moves costs nothing.
let pending: { item: DraggedItem; startX: number; startY: number } | null = null;

/** The EditorView whose content sits under the given viewport point, or null.
 *  Plain-text editors are skipped — a wiki-link won't resolve there (#1129). */
function viewAt(x: number, y: number): EditorView | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const cm = el?.closest<HTMLElement>('.cm-editor');
  if (!cm || cm.dataset.plaintext === 'true') return null;
  return EditorView.findFromDOM(cm);
}

function onMove(e: PointerEvent): void {
  if (!pending) return;
  if (!dragging) {
    if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) < DRAG_THRESHOLD) return;
    dragging = pending.item;
    document.body.classList.add('link-dragging');
  }
  ghost = { x: e.clientX, y: e.clientY };
  const view = viewAt(e.clientX, e.clientY);
  const pos = view?.posAtCoords({ x: e.clientX, y: e.clientY });
  const c = view && pos != null ? view.coordsAtPos(pos) : null;
  caret = c ? { left: c.left, top: c.top, bottom: c.bottom } : null;
}

function onUp(e: PointerEvent): void {
  teardown();
  const item = dragging;
  reset();
  if (!item) return; // never passed the threshold → treat as a plain click
  const view = viewAt(e.clientX, e.clientY);
  const pos = view?.posAtCoords({ x: e.clientX, y: e.clientY });
  if (view && pos != null) insertWikiLinkAtPos(view, pos, wikiLinkForItem(item));
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') { teardown(); reset(); }
}

function teardown(): void {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('keydown', onKey);
}

function reset(): void {
  pending = null;
  dragging = null;
  ghost = null;
  caret = null;
  document.body.classList.remove('link-dragging');
}

export function getLinkDrag() {
  return {
    get dragging() { return dragging; },
    get ghost() { return ghost; },
    get caret() { return caret; },
    /** Begin a link drag from a list item's `pointerdown` (left button only). */
    start(item: DraggedItem, e: PointerEvent): void {
      if (e.button !== 0) return;
      pending = { item, startX: e.clientX, startY: e.clientY };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
      window.addEventListener('keydown', onKey);
    },
  };
}
