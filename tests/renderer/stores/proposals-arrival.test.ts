/**
 * Arrival-detection semantics of the proposals store (#1541).
 *
 * The store diffs each re-list against the previous *pending* set and coalesces
 * a burst into one arrival batch. These assert the load-bearing distinctions: a
 * newly-pending proposal is an arrival; a baseline (first load / thoughtbase
 * switch) and an approve/reject are NOT; a burst becomes a single batch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { listMock, refs } = vi.hoisted(() => {
  const refs: { onChanged?: () => void; onProjectOpened?: () => void } = {};
  return { listMock: vi.fn(), refs };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    proposals: { list: listMock, onChanged: (cb: () => void) => { refs.onChanged = cb; } },
    menu: { onProjectOpened: (cb: () => void) => { refs.onProjectOpened = cb; } },
  },
}));

import { getProposalsStore } from '../../../src/renderer/lib/stores/proposals.svelte';

type P = { uri: string; status: string; proposedBy: string };
const p = (uri: string, status = 'pending', proposedBy = 'mcp:agent'): P => ({ uri, status, proposedBy });

let store: ReturnType<typeof getProposalsStore>;
let batches: P[][];
let unsub: () => void;

/** Re-baseline the store to `list` without emitting (thoughtbase-switch path). */
async function baseline(list: P[]): Promise<void> {
  listMock.mockResolvedValue(list);
  refs.onProjectOpened!();
  await vi.advanceTimersByTimeAsync(300);
}
/** A PROPOSALS_CHANGED re-list to `list`; flush the coalescing debounce. */
async function change(list: P[]): Promise<void> {
  listMock.mockResolvedValue(list);
  refs.onChanged!();
  await vi.advanceTimersByTimeAsync(300);
}

beforeEach(async () => {
  vi.useFakeTimers();
  listMock.mockReset();
  listMock.mockResolvedValue([]); // default so the singleton's initial start() refresh is safe
  store = getProposalsStore(); // start() wires refs on first call (module singleton)
  await baseline([]);          // clear any prior-test state
  batches = [];
  unsub = store.onArrival((b) => batches.push(b));
});
afterEach(() => { unsub(); vi.useRealTimers(); });

describe('proposals store arrival detection (#1541)', () => {
  it('emits an arrival for a newly-pending proposal, carrying proposedBy', async () => {
    await change([p('a', 'pending', 'mcp:research-agent')]);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((x) => x.uri)).toEqual(['a']);
    expect(batches[0]![0]!.proposedBy).toBe('mcp:research-agent');
  });

  it('does NOT emit on baseline (thoughtbase switch / first load)', async () => {
    await baseline([p('a'), p('b')]);
    expect(batches).toEqual([]);
  });

  it('does NOT emit when a proposal is approved/rejected (leaves pending)', async () => {
    await baseline([p('a', 'pending')]);
    batches = [];
    await change([p('a', 'approved')]); // same uri, no longer pending
    expect(batches).toEqual([]);
  });

  it('coalesces a burst of arrivals into a single batch', async () => {
    // Two PROPOSALS_CHANGED within the debounce window → one alert of two.
    listMock.mockResolvedValue([p('a')]);
    refs.onChanged!();
    await vi.advanceTimersByTimeAsync(100);
    listMock.mockResolvedValue([p('a'), p('b')]);
    refs.onChanged!();
    await vi.advanceTimersByTimeAsync(300);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((x) => x.uri).sort()).toEqual(['a', 'b']);
  });

  it('only the NEW proposal in a growing list is an arrival', async () => {
    await baseline([p('a')]);
    batches = [];
    await change([p('a'), p('b')]); // a already known, b is new
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((x) => x.uri)).toEqual(['b']);
  });
});
