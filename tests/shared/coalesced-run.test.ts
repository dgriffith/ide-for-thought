/**
 * coalescedRun: overlapping "recompute and publish" requests can't publish out
 * of order — the dock-badge race, replayed with controllable timing.
 */
import { describe, it, expect } from 'vitest';
import { coalescedRun } from '../../src/shared/coalesced-run';

/** A recompute whose reads resolve only when the test says so. */
function controllable() {
  const resolvers: Array<() => void> = [];
  let state = 1; // pending proposals in the store
  const published: number[] = [];
  const recompute = async () => {
    const seen = state; // the read: taken when the run STARTS
    await new Promise<void>((r) => resolvers.push(r));
    published.push(seen);
  };
  return { resolvers, published, set: (n: number) => { state = n; }, recompute };
}

describe('coalescedRun', () => {
  it('the bug: uncoalesced, a stale read landing last publishes the wrong count', async () => {
    const c = controllable();
    const first = c.recompute(); // event 1: proposal filed → reads 1
    c.set(0); // approved
    const second = c.recompute(); // event 2: reads 0
    c.resolvers[1]!(); await second; // the fresh read lands first…
    c.resolvers[0]!(); await first; // …the stale one last
    expect(c.published.at(-1)).toBe(1); // badge stuck at 1
  });

  it('coalesced, the last publish always comes from a read after the last request', async () => {
    const c = controllable();
    const run = coalescedRun(c.recompute);
    const first = run(); // reads 1, in flight
    c.set(0);
    const second = run(); // marks dirty — doesn't start a parallel read
    expect(c.resolvers).toHaveLength(1);
    c.resolvers[0]!(); // first finishes, then it goes round again
    await new Promise((r) => setTimeout(r, 0));
    expect(c.resolvers).toHaveLength(2);
    c.resolvers[1]!();
    await Promise.all([first, second]);
    expect(c.published).toEqual([1, 0]);
  });

  it('a burst of requests costs at most two runs', async () => {
    let runs = 0;
    let release!: () => void;
    const run = coalescedRun(async () => {
      runs++;
      if (runs === 1) await new Promise<void>((r) => { release = r; });
    });
    const all = [run(), run(), run(), run(), run()];
    release();
    await Promise.all(all);
    expect(runs).toBe(2);
    await run(); // and idle again afterwards: a new request runs once
    expect(runs).toBe(3);
  });

  it('a failing run does not wedge later requests', async () => {
    let fail = true;
    let runs = 0;
    const run = coalescedRun(async () => { runs++; if (fail) throw new Error('boom'); });
    await expect(run()).rejects.toThrow('boom');
    fail = false;
    await run();
    expect(runs).toBe(2);
  });
});
