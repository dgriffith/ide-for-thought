/**
 * Drag-tab-to-split hit-testing (#817).
 *
 * A pane is divided into five drop zones: four edge bands and a center. Dropping
 * a tab on an edge splits the pane along that axis and moves the tab into the
 * new sub-pane on that side; dropping on the center moves the tab into the pane
 * without splitting. Pure so the geometry is unit-testable away from the DOM.
 */

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

/** Fraction of the pane's width/height each edge band occupies. */
const EDGE = 0.25;

/**
 * Classify a drop point given as fractions of the pane's size (x, y ∈ [0,1],
 * origin top-left). Left/right take priority over top/bottom at the corners so
 * the horizontal split is the easier target (it's the more common one), and
 * anything in the middle is the center "move here" zone.
 */
export function dropZoneFromFraction(x: number, y: number): DropZone {
  if (x < EDGE) return 'left';
  if (x > 1 - EDGE) return 'right';
  if (y < EDGE) return 'top';
  if (y > 1 - EDGE) return 'bottom';
  return 'center';
}

/** The split a given edge zone implies: axis + which side the new pane lands on.
 *  `center` returns null (no split — a plain move into the target pane). */
export function splitForZone(
  zone: DropZone,
): { direction: 'horizontal' | 'vertical'; before: boolean } | null {
  switch (zone) {
    case 'left':
      return { direction: 'horizontal', before: true };
    case 'right':
      return { direction: 'horizontal', before: false };
    case 'top':
      return { direction: 'vertical', before: true };
    case 'bottom':
      return { direction: 'vertical', before: false };
    case 'center':
      return null;
  }
}
