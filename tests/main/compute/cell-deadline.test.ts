/**
 * @vitest-environment node
 *
 * Cell execution deadlines — the policy half (#2218).
 *
 * `python-kernel-timeout.test.ts` proves the feature end-to-end against a real
 * interpreter; it can only afford a handful of cases, each costing seconds of
 * wall clock. This file covers the decisions instead: WHICH cell gets armed,
 * when the arming is dropped, and what happens when an interrupt is ignored.
 *
 * Those are the parts where a mistake is expensive and invisible. Arming a
 * queued cell instead of the running one SIGINTs innocent work; failing to
 * disarm a finished cell does the same a moment later. Neither shows up as a
 * failing assertion in a happy-path test — it shows up as somebody's
 * half-finished analysis dying for no reason on a busy machine.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createCellDeadlines,
  cellTimeoutMessage,
  INTERRUPT_GRACE_MS,
  type DeadlineHost,
} from '../../../src/main/compute/cell-deadline';

interface Harness {
  host: DeadlineHost;
  /** Cell ids the fake kernel still owes a `done` for, in order. */
  queue: string[];
  budgets: Map<string, number>;
  interrupts: number;
  hardResets: number;
  timedOut: string[];
  /** What `interrupt()` reports — false models Windows / a dead process. */
  signalLands: boolean;
}

function harness(): Harness {
  const h: Harness = {
    host: undefined as unknown as DeadlineHost,
    queue: [],
    budgets: new Map(),
    interrupts: 0,
    hardResets: 0,
    timedOut: [],
    signalLands: true,
  };
  h.host = {
    pendingCellIds: () => [...h.queue],
    budgetMs: (id) => h.budgets.get(id) ?? 0,
    interrupt: () => { h.interrupts += 1; return h.signalLands; },
    markTimedOut: (id) => { h.timedOut.push(id); },
    hardReset: () => { h.hardResets += 1; },
  };
  return h;
}

/** Submit a cell to the fake kernel's queue with a budget. */
function submit(h: Harness, id: string, budgetMs: number): void {
  h.queue.push(id);
  h.budgets.set(id, budgetMs);
}

/** The fake kernel finished `id` — mirrors the real `done` handling order. */
function complete(h: Harness, id: string, deadlines: ReturnType<typeof createCellDeadlines>): void {
  deadlines.clear(id);
  h.queue = h.queue.filter((q) => q !== id);
  deadlines.syncHead();
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createCellDeadlines — which cell gets armed (#2218)', () => {
  it('interrupts the head cell once its budget elapses', () => {
    const h = harness();
    const d = createCellDeadlines(h.host);
    submit(h, 'a', 1000);
    d.syncHead();

    vi.advanceTimersByTime(999);
    expect(h.interrupts).toBe(0);

    vi.advanceTimersByTime(1);
    expect(h.interrupts).toBe(1);
    expect(h.timedOut).toEqual(['a']);
  });

  it('a cell QUEUED behind a running one is not on the clock until its turn', () => {
    // The whole reason the deadline tracks the head rather than every
    // submission. `b` is written to the kernel's stdin immediately, but the
    // kernel is serial — it won't look at `b` until `a` returns. Timing `b`
    // from submission would interrupt `a` (which is inside its own budget)
    // and report `b` as having exceeded a limit it never started counting
    // against.
    const h = harness();
    const d = createCellDeadlines(h.host);
    submit(h, 'a', 10_000);
    d.syncHead();
    submit(h, 'b', 1000);
    d.syncHead();

    // Well past b's budget, still inside a's.
    vi.advanceTimersByTime(5000);
    expect(h.interrupts).toBe(0);
    expect(h.timedOut).toEqual([]);

    // a finishes; b is now what the kernel is running, and gets its full
    // budget from this moment.
    complete(h, 'a', d);
    vi.advanceTimersByTime(999);
    expect(h.interrupts).toBe(0);
    vi.advanceTimersByTime(1);
    expect(h.timedOut).toEqual(['b']);
  });

  it('re-syncing does not restart a live head cell\'s budget', () => {
    // syncHead is called on every submit as well as every completion, so a
    // busy notebook can call it repeatedly while one long cell runs. If each
    // call re-armed, a cell could outrun its budget indefinitely just because
    // other cells kept arriving.
    const h = harness();
    const d = createCellDeadlines(h.host);
    submit(h, 'a', 1000);
    d.syncHead();

    vi.advanceTimersByTime(900);
    d.syncHead();
    d.syncHead();
    vi.advanceTimersByTime(100);

    expect(h.interrupts).toBe(1);
  });

  it('a zero budget means no limit — nothing is ever armed', () => {
    const h = harness();
    const d = createCellDeadlines(h.host);
    submit(h, 'a', 0);
    d.syncHead();

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(h.interrupts).toBe(0);
    expect(h.hardResets).toBe(0);
  });

  it('a completed cell is disarmed — no timer of its own is left running', () => {
    // Asserted on the TIMER, not only on the absence of an interrupt. The
    // behaviour is guarded twice on purpose (`fire` also re-checks the queue),
    // and an outcome-only assertion passes with either half missing — so it
    // would not have noticed `clear` quietly becoming a no-op. Measured: with
    // `clear` neutered and the queue check left in place, an
    // `expect(h.interrupts).toBe(0)` version of this test still passed.
    //
    // A stale timer is not cosmetic: it keeps the event loop alive for the
    // rest of the budget and, if the cell id were ever reused, would arm
    // against work that isn't the one it was created for.
    const h = harness();
    const d = createCellDeadlines(h.host);
    submit(h, 'a', 1000);
    d.syncHead();
    expect(vi.getTimerCount()).toBe(1);

    complete(h, 'a', d);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(10_000);
    expect(h.interrupts).toBe(0);
    expect(h.timedOut).toEqual([]);
  });

  it('a finished cell never interrupts the one the kernel moved on to', () => {
    // The outcome the disarming exists for, stated on its own: `a` completes
    // and `b` is now running. Nothing belonging to `a` may touch `b`.
    const h = harness();
    const d = createCellDeadlines(h.host);
    submit(h, 'a', 1000);
    d.syncHead();
    submit(h, 'b', 60_000);
    d.syncHead();

    complete(h, 'a', d);
    vi.advanceTimersByTime(20_000);

    expect(h.interrupts).toBe(0);
    expect(h.timedOut).toEqual([]);
  });

  it('clearAll() disarms everything (kernel exit / shutdown)', () => {
    const h = harness();
    const d = createCellDeadlines(h.host);
    submit(h, 'a', 1000);
    d.syncHead();
    expect(vi.getTimerCount()).toBe(1);

    d.clearAll();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(h.interrupts).toBe(0);
  });

  it('does not fire for a cell that left the queue in the same tick', () => {
    // Defence in depth for the race the real kernel can produce: the `done`
    // event and the expiring timer land in the same turn of the event loop.
    // `clear` normally wins, but `fire` re-checks rather than trusting that.
    const h = harness();
    const d = createCellDeadlines(h.host);
    submit(h, 'a', 1000);
    d.syncHead();

    h.queue = []; // completed, but clear() deliberately NOT called
    vi.advanceTimersByTime(1000);

    expect(h.interrupts).toBe(0);
    expect(h.timedOut).toEqual([]);
  });
});

describe('createCellDeadlines — escalation when the interrupt is ignored (#2218)', () => {
  it('kills the kernel if the cell is still pending after the grace window', () => {
    const h = harness();
    const d = createCellDeadlines(h.host);
    submit(h, 'a', 1000);
    d.syncHead();

    vi.advanceTimersByTime(1000);
    expect(h.interrupts).toBe(1);
    // Interrupt first, and give it a real chance — killing costs every
    // notebook's namespace.
    expect(h.hardResets).toBe(0);

    vi.advanceTimersByTime(INTERRUPT_GRACE_MS - 1);
    expect(h.hardResets).toBe(0);

    vi.advanceTimersByTime(1);
    expect(h.hardResets).toBe(1);
  });

  it('does NOT kill the kernel when the interrupt worked', () => {
    const h = harness();
    const d = createCellDeadlines(h.host);
    submit(h, 'a', 1000);
    d.syncHead();

    vi.advanceTimersByTime(1000);
    // The kernel raised KeyboardInterrupt and sent `done`.
    complete(h, 'a', d);

    vi.advanceTimersByTime(INTERRUPT_GRACE_MS * 2);
    expect(h.hardResets).toBe(0);
  });

  it('escalates immediately when no signal could be sent at all', () => {
    // Windows (`unsupported-platform`) or an already-dead process. Waiting out
    // a grace period for a reply to a signal nobody delivered just extends the
    // time the project stays wedged.
    const h = harness();
    h.signalLands = false;
    const d = createCellDeadlines(h.host, 30_000);
    submit(h, 'a', 1000);
    d.syncHead();

    vi.advanceTimersByTime(1000);
    expect(h.interrupts).toBe(1);
    expect(h.hardResets).toBe(0);

    vi.advanceTimersByTime(1);
    expect(h.hardResets).toBe(1);
  });
});

describe('cellTimeoutMessage (#2218)', () => {
  it('names the budget and where to change it', () => {
    const msg = cellTimeoutMessage(120_000, false);
    expect(msg).toContain('120s');
    expect(msg).toContain('Settings');
    expect(msg).toContain('Compute');
  });

  it('the restarted variant says the namespaces are gone', () => {
    // Losing every notebook's variables is the kind of thing a user must not
    // have to infer from a cell suddenly raising NameError.
    const msg = cellTimeoutMessage(60_000, true);
    expect(msg).toMatch(/restarted/i);
    expect(msg).toMatch(/variables/i);
  });

  it('never reports a 0s limit for a sub-second budget', () => {
    expect(cellTimeoutMessage(400, false)).toContain('1s');
  });
});
