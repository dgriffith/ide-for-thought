/**
 * Where each Timeline event sits (#2608): its lane, and whether it draws as a
 * point or a bar, at one zoom. Pure.
 *
 * - **Lanes come from `packLanes`** (`shared/objects/interval-lanes.ts`),
 *   packed in **pixels** at the current scale, so a point, a short bar and
 *   their labels keep clear of each other on screen. Packing depends only on
 *   the scale (px per ms), never on where the view starts — packing is
 *   translation-invariant — so the component recomputes lanes on zoom and not
 *   on pan, and lanes don't jump while you drag.
 * - **A point or a bar.** An event narrower than the point marker at this
 *   scale draws as a point (a day at decade zoom); otherwise a bar.
 * - **Labels** sit inside a bar's widest solid stretch when it is wide
 *   enough to hold them (`--accent-ink` on `--accent`; never on the hatch,
 *   where text can't hold contrast) and otherwise to the right of the mark
 *   (`--text` on `--bg`); a label outside the mark is part of what it occupies, so no label
 *   runs into the next event. Every item reserves half a marker before its
 *   start, so a point (drawn centred on its instant) and a bar starting at the
 *   same instant pack the same way.
 * - **Keyboard order is the packer's rule in time units**
 *   (`compareLaneItems` on start, end, title, key), so it doesn't move with
 *   the zoom: the same data always steps the same way.
 */
import { compareLaneItems, packLanes } from '../../../../shared/objects/interval-lanes';
import type { TimelineEvent } from './timeline-events';

/** A point marker's width, px — also the narrowest a bar draws before it is a point. */
export const MARKER_PX = 12;
/** Clear space after each item in its lane, px. */
export const GAP_PX = 6;
/** One lane's height, and a bar's within it, px. */
export const LANE_PX = 24;
export const BAR_PX = 14;
/** A label's estimated advance per character (11px UI font), and its longest. */
export const LABEL_CHAR_PX = 6.6;
export const MAX_LABEL_CHARS = 40;
const LABEL_PAD_PX = 4;

export interface Placement {
  lane: number;
  point: boolean;
  /** The label sits inside the bar, in this solid stretch (civil ms); null = outside it. */
  labelIn: { start: number; end: number } | null;
  /** The label as drawn (shortened past `MAX_LABEL_CHARS`). */
  labelText: string;
}

export interface TimelineLayout {
  placements: Map<string, Placement>;
  laneCount: number;
}

export function shortLabel(title: string): string {
  return title.length > MAX_LABEL_CHARS ? `${title.slice(0, MAX_LABEL_CHARS - 1)}…` : title;
}

export function labelWidth(text: string): number {
  return text.length * LABEL_CHAR_PX;
}

/** Lanes and marks at `pxPerMs` (see the header). */
export function layoutTimeline(events: readonly TimelineEvent[], pxPerMs: number): TimelineLayout {
  const half = MARKER_PX / 2;
  const meta = new Map<string, Omit<Placement, 'lane'>>();
  const items = events.map((ev) => {
    const x0 = ev.start * pxPerMs;
    const w = (ev.end - ev.start) * pxPerMs;
    const point = w < MARKER_PX;
    const labelText = shortLabel(ev.title);
    const lw = labelWidth(labelText);
    let labelIn: { start: number; end: number } | null = null;
    if (!point) {
      const solid = ev.segments.filter((s) => !s.approx).sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      if (solid && (solid.end - solid.start) * pxPerMs >= lw + 2 * LABEL_PAD_PX) labelIn = { start: solid.start, end: solid.end };
    }
    meta.set(ev.key, { point, labelIn, labelText });
    const markEnd = point ? x0 + half : x0 + w;
    return { key: ev.key, title: ev.title, start: x0 - half, end: labelIn ? markEnd : markEnd + LABEL_PAD_PX + lw };
  });
  const { lanes, laneCount } = packLanes(items, { minExtent: MARKER_PX, gap: GAP_PX });
  const placements = new Map<string, Placement>();
  for (const [key, m] of meta) placements.set(key, { ...m, lane: lanes.get(key) ?? 0 });
  return { placements, laneCount };
}

/**
 * Room Fit leaves after the latest marks for their labels, px: the widest
 * label among the events ending in the last tenth of the extent (capped).
 */
export function trailingLabelRoom(events: readonly TimelineEvent[], extentEnd: number, extentWidth: number): number {
  let room = 0;
  for (const ev of events) {
    if (ev.end >= extentEnd - extentWidth / 10) room = Math.max(room, labelWidth(shortLabel(ev.title)));
  }
  return room > 0 ? room + MARKER_PX + LABEL_PAD_PX : 0;
}

/** The events' keys in keyboard (time) order. */
export function timeOrder(events: readonly TimelineEvent[]): string[] {
  return [...events]
    .map((ev) => ({ key: ev.key, start: ev.start, end: ev.end, title: ev.title }))
    .sort(compareLaneItems)
    .map((i) => i.key);
}

/** Past this many dated events the live timeline draws only what is in view
 *  (the spike's Decision 3 starting threshold; tunable). */
export const VIRTUALIZE_ABOVE = 1000;

/**
 * The events to draw when virtualised: those meeting the view widened by half
 * a screen each side, in the lanes `[firstLane, lastLane]` — plus `keep` (the
 * roving tab stop) wherever it is, so the timeline never loses its one tab
 * stop and the keyboard order stays whole.
 */
export function cullToView(
  events: readonly TimelineEvent[],
  layout: TimelineLayout,
  view: { start: number; end: number },
  lanes: { first: number; last: number },
  keep: string | null,
): TimelineEvent[] {
  const over = (view.end - view.start) / 2;
  const lo = view.start - over;
  const hi = view.end + over;
  return events.filter((ev) => {
    if (ev.key === keep) return true;
    const lane = layout.placements.get(ev.key)?.lane ?? 0;
    return ev.end >= lo && ev.start <= hi && lane >= lanes.first && lane <= lanes.last;
  });
}
