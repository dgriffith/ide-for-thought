/**
 * Deterministic lane packing for intervals (#2611, epic #2606): give each
 * item a lane (row) so no two items in one lane overlap — the Timeline's
 * "nothing hides behind anything else". Decided in the Timeline design spike
 * (`docs/vision/objects-expansion.md`, "Timeline"); the layout that draws the
 * lanes is #2608's.
 *
 * Unit-agnostic: pass civil-axis ms, or pixels at the current zoom. Packing in
 * **pixels** is what the timeline wants — a point event or a short bar still
 * occupies its marker's width on screen, which `minExtent` and `gap` express
 * — and is why lanes are recomputed when the zoom changes.
 *
 * The rule, precisely (so the same data always draws the same way):
 *
 * 1. Each item occupies [start, max(end, start + minExtent)) plus `gap` after
 *    it.
 * 2. Items are taken in order of start, then end (the *written* end, before
 *    `minExtent`), then title (`localeCompare`-free code-unit order, so the
 *    result doesn't depend on the viewer's locale), then key — the last a
 *    unique tie-break (a note path) so equal items can't swap between runs.
 * 3. Each item goes in the **lowest-numbered lane that is free** at its start
 *    (a lane is free when the occupied extent of its last item, gap included,
 *    ends at or before the item's start); if none is, a new lane.
 *
 * That's first-fit by lane index, done with two heaps in O(n log n): busy
 * lanes ordered by when they free up, and free lane numbers. Because items
 * arrive in start order, a lane free at one item's start stays free for every
 * later item until it is taken — so the heaps give exactly first-fit's answer.
 */

export interface LaneItem {
  /** Unique and stable: the final tie-break. */
  key: string;
  start: number;
  /** ≥ start. A point is start === end. */
  end: number;
  title: string;
}

export interface LaneOptions {
  /** The least an item occupies, in the same units (a point marker's width). */
  minExtent?: number;
  /** Space kept clear after each item in its lane. */
  gap?: number;
}

export interface LanePacking {
  /** Lane per item key. */
  lanes: Map<string, number>;
  laneCount: number;
  /** Item keys in packing order — also the keyboard's time order (#2608). */
  order: string[];
}

/** The order rule 2 above describes. */
export function compareLaneItems(a: LaneItem, b: LaneItem): number {
  return a.start - b.start || a.end - b.end || cmp(a.title, b.title) || cmp(a.key, b.key);
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function packLanes(items: readonly LaneItem[], opts: LaneOptions = {}): LanePacking {
  const minExtent = Math.max(0, opts.minExtent ?? 0);
  const gap = Math.max(0, opts.gap ?? 0);
  const sorted = [...items].sort(compareLaneItems);
  const lanes = new Map<string, number>();
  // busy: [freeAt, lane] min-heap by freeAt (then lane); free: lane numbers.
  const busy = new MinHeap<[number, number]>((a, b) => a[0] - b[0] || a[1] - b[1]);
  const free = new MinHeap<number>((a, b) => a - b);
  let laneCount = 0;
  for (const item of sorted) {
    while (busy.size > 0 && busy.peek()![0] <= item.start) free.push(busy.pop()![1]);
    const lane = free.size > 0 ? free.pop()! : laneCount++;
    lanes.set(item.key, lane);
    busy.push([Math.max(item.end, item.start + minExtent) + gap, lane]);
  }
  return { lanes, laneCount, order: sorted.map((i) => i.key) };
}

/** A small binary heap; `less` < 0 means a comes out first. */
class MinHeap<T> {
  private readonly a: T[] = [];
  constructor(private readonly less: (x: T, y: T) => number) {}
  get size(): number { return this.a.length; }
  peek(): T | undefined { return this.a[0]; }
  push(v: T): void {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i]!, a[p]!) >= 0) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last !== undefined) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l]!, a[m]!) < 0) m = l;
        if (r < a.length && this.less(a[r]!, a[m]!) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}
