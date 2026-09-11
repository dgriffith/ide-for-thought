/**
 * Proposals store (#1525) — the single source of truth for pending review.
 *
 * Verifies it lists on the `PROPOSALS_CHANGED` event and on `project:opened`,
 * derives a global `pendingCount`, and wires its subscriptions exactly once.
 * The IPC client is mocked; the mock captures the store's event callbacks so
 * the test can fire them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let listResult: unknown[] = [];
let onChangedCb: (() => void) | null = null;
let onProjectOpenedCb: (() => void) | null = null;

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    proposals: {
      list: vi.fn(async () => listResult),
      onChanged: vi.fn((cb: () => void) => {
        onChangedCb = cb;
      }),
    },
    menu: {
      onProjectOpened: vi.fn((cb: () => void) => {
        onProjectOpenedCb = cb;
      }),
    },
  },
}));

import { getProposalsStore } from '../../../src/renderer/lib/stores/proposals.svelte';

function p(uri: string, status: string) {
  return { uri, status, operationType: 'component_creation', note: '', proposedBy: 'cli', proposedAt: '2020-01-01', payloads: [] };
}

const store = getProposalsStore();

beforeEach(async () => {
  listResult = [];
  await store.refresh();
});

describe('proposals store (#1525)', () => {
  it('re-lists on PROPOSALS_CHANGED and derives a global pendingCount', async () => {
    listResult = [p('a', 'pending'), p('b', 'pending'), p('c', 'approved')];
    onChangedCb!(); // a proposal was filed / approved / rejected / expired
    await vi.waitFor(() => expect(store.proposals).toHaveLength(3));
    // pendingCount ignores the two non-pending, and isn't filtered by any panel.
    expect(store.pendingCount).toBe(2);
    expect(store.loaded).toBe(true);
  });

  it('re-lists on project:opened (thoughtbase switch swaps the whole set)', async () => {
    listResult = [p('z', 'approved')];
    onProjectOpenedCb!();
    await vi.waitFor(() => expect(store.proposals.map((x) => x.uri)).toEqual(['z']));
    expect(store.pendingCount).toBe(0);
  });

  it('refresh() re-lists on demand', async () => {
    listResult = [p('x', 'pending')];
    await store.refresh();
    expect(store.pendingCount).toBe(1);
  });

  it('wires each subscription exactly once across multiple store accesses', async () => {
    // The module-level `getProposalsStore()` above (line 38) is the file's
    // real "first access" — Vitest 5's `clearMocks: true` default wipes that
    // call's history before this test runs, so asserting against it directly
    // would read as 0 regardless of whether wiring is actually deduped.
    // `resetModules()` + a fresh dynamic import gives this one test its own
    // singleton and its own freshly-`vi.fn()`-backed mock, so "first access
    // wires, second doesn't" is provable within the test's own window.
    vi.resetModules();
    const { api: freshApi } = await import('../../../src/renderer/lib/ipc/client');
    const { getProposalsStore: freshGetProposalsStore } = await import('../../../src/renderer/lib/stores/proposals.svelte');
    freshGetProposalsStore();
    freshGetProposalsStore();
    expect(freshApi.proposals.onChanged).toHaveBeenCalledTimes(1);
    expect(freshApi.menu.onProjectOpened).toHaveBeenCalledTimes(1);
  });
});
