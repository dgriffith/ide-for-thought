/**
 * What an exported Timeline draws (#2609, epic #2606). Pure.
 *
 * An export is one static picture of the view's range — the spec's `from` /
 * `to`, or fit-all — at the export width, with nothing to scroll, zoom or
 * hover. So, unlike the live view:
 *
 * - **Only events meeting the range are laid out.** The live view lays out
 *   everything and lets the viewport clip; a page would carry the off-range
 *   events as empty lanes (and, in a PDF, as links nobody can see).
 * - **At most `EXPORT_MAX_LANES` lanes** (the epic's decision 5). An event
 *   packed into a lane past the cap is left out of the drawing and named in
 *   the "+N more" note; it is still in the event list that follows.
 * - **Every event in range is listed**, in time order, under the drawing —
 *   see `TypeViewTimeline.svelte` for why a print reader gets the list as
 *   well as the linked drawing.
 */
import type { TimelineEvent } from './timeline-events';
import { layoutTimeline, timeOrder, type TimelineLayout } from './timeline-layout';
import type { Domain } from './timeline-scale';

/** Lanes an exported timeline draws before the rest go to "+N more" (decision 5; tunable). */
export const EXPORT_MAX_LANES = 30;

export interface TimelineExportPlan {
  /** Drawn: in range, and in a lane under the cap. */
  drawn: TimelineEvent[];
  layout: TimelineLayout;
  /** Lanes the drawing takes (never more than the cap). */
  laneCount: number;
  /** In range but past the lane cap, in time order — the "+N more". */
  overflow: TimelineEvent[];
  /** Every event in range, in time order — the list after the drawing. */
  listed: TimelineEvent[];
  /** Dated events wholly outside the range. */
  outside: number;
}

export function planTimelineExport(
  dated: readonly TimelineEvent[],
  domain: Domain,
  width: number,
  maxLanes = EXPORT_MAX_LANES,
): TimelineExportPlan {
  if (!(domain.end > domain.start) || !(width > 0)) throw new Error(`can't draw the range ${domain.start}..${domain.end} at ${width}px`);
  const inRange = dated.filter((ev) => ev.end > domain.start && ev.start < domain.end);
  const layout = layoutTimeline(inRange, width / (domain.end - domain.start));
  const byKey = new Map(inRange.map((ev) => [ev.key, ev] as const));
  const listed = timeOrder(inRange).map((k) => byKey.get(k)!);
  const lane = (ev: TimelineEvent) => layout.placements.get(ev.key)?.lane ?? 0;
  return {
    drawn: inRange.filter((ev) => lane(ev) < maxLanes),
    layout,
    laneCount: Math.min(layout.laneCount, maxLanes),
    overflow: listed.filter((ev) => lane(ev) >= maxLanes),
    listed,
    outside: dated.length - inRange.length,
  };
}
