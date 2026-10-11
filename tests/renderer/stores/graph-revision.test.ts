/**
 * The graph revision views re-project against (#2742) moves on main's
 * `graph:changed` event — any write, not only an editor save.
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ listeners: [] as Array<() => void> }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { graph: { onChanged: vi.fn((cb: () => void) => { h.listeners.push(cb); return () => undefined; }) } },
}));

import { getGraphRevisionStore } from '../../../src/renderer/lib/stores/graph-revision.svelte';
import { api } from '../../../src/renderer/lib/ipc/client';

describe('graph revision store', () => {
  it('subscribes once, however many readers', () => {
    getGraphRevisionStore();
    getGraphRevisionStore();
    expect(api.graph.onChanged).toHaveBeenCalledTimes(1);
  });

  it('moves on every graph:changed event', () => {
    const store = getGraphRevisionStore();
    const before = store.revision;
    h.listeners[0]!();
    expect(store.revision).toBe(before + 1);
    h.listeners[0]!();
    expect(store.revision).toBe(before + 2);
  });
});
