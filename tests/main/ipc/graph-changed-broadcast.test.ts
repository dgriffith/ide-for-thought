/**
 * Coalescing graph-changed signals into renderer broadcasts (#2742). Indexing
 * emits once per note, and each broadcast makes every open view re-run its
 * projection, so a burst must reach the renderer as one signal per project.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emitGraphChanged } from '../../../src/main/graph/graph-events';
import { coalesceGraphChanged, GRAPH_CHANGED_COALESCE_MS } from '../../../src/main/ipc/graph-changed-broadcast';
import { disposeAllProjectStores } from '../../../src/main/project-store';
import { projectContext } from '../../../src/main/project-context-types';

let off: (() => void) | null = null;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { off?.(); off = null; vi.useRealTimers(); });

describe('coalesceGraphChanged', () => {
  it('sends one signal per project for a burst, once the burst goes quiet', () => {
    const send = vi.fn();
    off = coalesceGraphChanged(send);
    for (let i = 0; i < 50; i++) emitGraphChanged('/vault'); // a 50-note rebuild
    emitGraphChanged('/other');
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(GRAPH_CHANGED_COALESCE_MS);
    expect(send.mock.calls).toEqual([['/vault'], ['/other']]);
  });

  it('a later write is its own signal', () => {
    const send = vi.fn();
    off = coalesceGraphChanged(send);
    emitGraphChanged('/vault');
    vi.advanceTimersByTime(GRAPH_CHANGED_COALESCE_MS);
    emitGraphChanged('/vault');
    vi.advanceTimersByTime(GRAPH_CHANGED_COALESCE_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps waiting while the burst continues', () => {
    const send = vi.fn();
    off = coalesceGraphChanged(send);
    for (let i = 0; i < 5; i++) {
      emitGraphChanged('/vault');
      vi.advanceTimersByTime(GRAPH_CHANGED_COALESCE_MS - 10);
    }
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends nothing after unsubscribing, even for a burst already pending', () => {
    const send = vi.fn();
    off = coalesceGraphChanged(send);
    emitGraphChanged('/vault');
    off();
    off = null;
    emitGraphChanged('/vault');
    vi.advanceTimersByTime(GRAPH_CHANGED_COALESCE_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it('closing a thoughtbase cancels the broadcast it was owed', async () => {
    const send = vi.fn();
    off = coalesceGraphChanged(send);
    emitGraphChanged('/vault');
    emitGraphChanged('/other');
    await disposeAllProjectStores(projectContext('/vault'));
    vi.advanceTimersByTime(GRAPH_CHANGED_COALESCE_MS);
    expect(send.mock.calls).toEqual([['/other']]);
  });
});
