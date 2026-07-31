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

import { api } from '../../../src/renderer/lib/ipc/client';
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

  it('wires each subscription exactly once across multiple store accesses', () => {
    getProposalsStore();
    getProposalsStore();
    expect(api.proposals.onChanged).toHaveBeenCalledTimes(1);
    expect(api.menu.onProjectOpened).toHaveBeenCalledTimes(1);
  });
});
