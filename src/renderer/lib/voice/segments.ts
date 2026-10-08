/**
 * Split a long recording into transcription segments (#2428).
 *
 * Dictation hands Whisper one short clip. A saved recording can run an hour,
 * and sending it as one buffer would hold every mel frame and every decoder
 * pass for the whole file in the worker at once. Instead the recording is cut
 * into segments of about `targetSec`, each sent on its own, so the worker only
 * ever holds one segment.
 *
 * A cut through the middle of a word garbles it on both sides, so each cut is
 * moved to the quietest short window within `searchSec` of the target. Speech
 * has pauses every few seconds, so a ±10s search almost always lands on one.
 * Pure: samples in, `[start, end)` sample ranges out.
 */

export interface SegmentOptions {
  /** Preferred segment length, in seconds. */
  targetSec?: number;
  /** How far either side of each target to look for a quiet cut, in seconds. */
  searchSec?: number;
  /** Energy window used to find the quiet point, in milliseconds. */
  windowMs?: number;
}

export type SampleRange = readonly [start: number, end: number];

/**
 * Plan the segments for `samples` at `sampleRate`. Ranges are contiguous, in
 * order, and together cover every sample. A recording no longer than about
 * 1.5 × `targetSec` is a single segment, so a final segment is never a sliver.
 */
export function planSegments(
  samples: Float32Array,
  sampleRate: number,
  opts: SegmentOptions = {},
): SampleRange[] {
  const targetSec = opts.targetSec ?? 120;
  const searchSec = opts.searchSec ?? 10;
  const windowMs = opts.windowMs ?? 50;
  const total = samples.length;
  if (total === 0) return [];

  const target = Math.max(1, Math.round(targetSec * sampleRate));
  const search = Math.max(0, Math.round(searchSec * sampleRate));
  const window = Math.max(1, Math.round((windowMs / 1000) * sampleRate));

  const ranges: SampleRange[] = [];
  let start = 0;
  while (total - start > target * 1.5) {
    const cut = quietestCut(samples, start + target, search, window, start + 1, total - 1);
    ranges.push([start, cut]);
    start = cut;
  }
  ranges.push([start, total]);
  return ranges;
}

/**
 * The centre of the lowest-energy `window` whose centre lies within
 * `[around - search, around + search]`, clamped to `[min, max]`. Ties go to
 * the window nearest `around`, so digital silence (all zeros) still cuts
 * close to the target rather than at the start of the search range.
 */
function quietestCut(
  samples: Float32Array,
  around: number,
  search: number,
  window: number,
  min: number,
  max: number,
): number {
  const lo = Math.max(min, around - search);
  const hi = Math.min(max, around + search);
  const half = Math.floor(window / 2);
  // Step by a quarter window: fine enough to find a pause, cheap enough to
  // scan ±10s of 16 kHz audio without a prefix-sum array.
  const step = Math.max(1, Math.floor(window / 4));

  let best = Math.min(Math.max(around, lo), hi);
  let bestEnergy = Infinity;
  let bestDistance = Infinity;
  for (let centre = lo; centre <= hi; centre += step) {
    const from = Math.max(0, centre - half);
    const to = Math.min(samples.length, centre + half + 1);
    let energy = 0;
    for (let i = from; i < to; i++) energy += samples[i]! * samples[i]!;
    energy /= to - from;
    const distance = Math.abs(centre - around);
    if (energy < bestEnergy || (energy === bestEnergy && distance < bestDistance)) {
      best = centre;
      bestEnergy = energy;
      bestDistance = distance;
    }
  }
  return best;
}
