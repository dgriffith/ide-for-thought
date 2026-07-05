/**
 * Divider-drag math for `SplitContainer` (#813).
 *
 * A split node holds fractional `sizes` (summing to ~1), one per child. Dragging
 * the divider between child `index` and `index+1` moves their shared boundary:
 * one grows by the same amount the other shrinks, so every *other* pane keeps
 * its size. Each of the pair is clamped to a minimum fraction so a pane can't be
 * dragged to nothing. Pure so the clamping is unit-testable without a DOM.
 */

export function redistributeSizes(
  sizes: number[],
  index: number,
  deltaFraction: number,
  minFraction: number,
): number[] {
  if (index < 0 || index + 1 >= sizes.length) return sizes;
  const next = [...sizes];
  const pair = next[index]! + next[index + 1]!;
  // The growing side can range over [min, pair - min] so neither falls below
  // the minimum. If the pair is too small to honor both minimums, the upper
  // bound wins (Math.min first), keeping behavior deterministic.
  const upper = Math.max(minFraction, pair - minFraction);
  const a = Math.min(upper, Math.max(minFraction, next[index]! + deltaFraction));
  next[index] = a;
  next[index + 1] = pair - a;
  return next;
}
