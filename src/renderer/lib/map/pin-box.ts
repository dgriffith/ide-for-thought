/**
 * Box selection on a map (#2939). A pin has no "next pin" the way a row does,
 * so a ⇧-click range means nothing on a map; the map-like gesture is a drag
 * rectangle. **⇧-drag draws it** — the gesture MapLibre's own box zoom used,
 * which the map turns off (`boxZoom: false`): zoom keeps its buttons, the
 * wheel and pinch, and ⇧-drag-to-select is the convention in map tools. The
 * pins inside are added to the selection; with ⌘ (Ctrl) held, each is
 * toggled instead.
 *
 * `pinsInBox` is the pure half (projected points against a rectangle);
 * `attachBoxSelect` the gesture, drawing an outline over the map while it
 * runs and holding MapLibre's drag-pan off so the drag doesn't also pan.
 */

/** A pin where the map draws it, in the container's pixels. */
export interface ProjectedPin {
  path: string;
  x: number;
  y: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The pins inside `box` (corners in any order), in the order given. */
export function pinsInBox(pins: readonly ProjectedPin[], box: Box): string[] {
  const left = Math.min(box.x0, box.x1);
  const right = Math.max(box.x0, box.x1);
  const top = Math.min(box.y0, box.y1);
  const bottom = Math.max(box.y0, box.y1);
  return pins.filter((p) => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom).map((p) => p.path);
}

/** A press smaller than this isn't a box: a ⇧-click on empty map does nothing. */
const MIN_BOX_PX = 4;

export interface BoxSelectHost {
  /** The map's container, where the gesture starts and the outline is drawn. */
  container: HTMLElement;
  /** MapLibre's drag-pan, held off while a box is drawn. */
  dragPan: { disable(): void; enable(): void };
  /** The pins that can be selected, where the map draws them now. */
  pins: () => ProjectedPin[];
  /** The box's pins; `toggle` when ⌘ / Ctrl was held. */
  onSelect: (paths: string[], toggle: boolean) => void;
}

/** Arm ⇧-drag box selection on the map; returns the teardown. */
export function attachBoxSelect(host: BoxSelectHost): () => void {
  const { container } = host;
  let start: { x: number; y: number; id: number } | null = null;
  let outline: HTMLDivElement | null = null;

  const local = (e: PointerEvent) => {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const draw = (b: Box) => {
    if (!outline) {
      outline = document.createElement('div');
      outline.className = 'map-select-box';
      outline.setAttribute('aria-hidden', 'true');
      container.appendChild(outline);
    }
    outline.style.left = `${Math.min(b.x0, b.x1)}px`;
    outline.style.top = `${Math.min(b.y0, b.y1)}px`;
    outline.style.width = `${Math.abs(b.x1 - b.x0)}px`;
    outline.style.height = `${Math.abs(b.y1 - b.y0)}px`;
  };
  const end = () => {
    start = null;
    outline?.remove();
    outline = null;
    host.dragPan.enable();
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
  };
  const onMove = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const p = local(e);
    draw({ x0: start.x, y0: start.y, x1: p.x, y1: p.y });
  };
  const onUp = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const p = local(e);
    const box = { x0: start.x, y0: start.y, x1: p.x, y1: p.y };
    end();
    if (Math.abs(box.x1 - box.x0) < MIN_BOX_PX && Math.abs(box.y1 - box.y0) < MIN_BOX_PX) return;
    host.onSelect(pinsInBox(host.pins(), box), e.metaKey || e.ctrlKey);
  };
  const onDown = (e: PointerEvent) => {
    // A press on a pin is the pin's (⇧-click toggles it); only empty map starts a box.
    if (!e.shiftKey || e.button !== 0 || (e.target as Element | null)?.closest('.maplibregl-marker, .maplibregl-ctrl')) return;
    e.preventDefault();
    host.dragPan.disable();
    start = { ...local(e), id: e.pointerId };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  };
  container.addEventListener('pointerdown', onDown, true);
  return () => {
    if (start) end();
    container.removeEventListener('pointerdown', onDown, true);
  };
}
