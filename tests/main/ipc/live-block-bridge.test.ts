/**
 * The exporting window's half of a live-block render (#2510): one request,
 * one answer, from the window that was asked — or a clean failure.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BrowserWindow } from 'electron';
import { Channels } from '../../../src/shared/channels';
import { LIVE_BLOCK_TIMEOUT_MS, receiveLiveBlockResults, windowLiveBlockRenderer } from '../../../src/main/ipc/live-block-bridge';
import type { LiveBlockRequest } from '../../../src/shared/live-blocks';

function fakeWin(id = 7, destroyed = false) {
  const send = vi.fn();
  return { win: { isDestroyed: () => destroyed, webContents: { id, send } } as unknown as BrowserWindow, send };
}
const blocks: LiveBlockRequest[] = [{ id: 'B0', kind: 'object-view', source: '{}', notePath: 'n.md' }];
const sentRequestId = (send: ReturnType<typeof vi.fn>) => (send.mock.calls[0]![1] as { requestId: string }).requestId;

afterEach(() => vi.useRealTimers());

describe('windowLiveBlockRenderer', () => {
  it('sends the batch to the window and resolves with its answer', async () => {
    const { win, send } = fakeWin();
    const p = windowLiveBlockRenderer(win)(blocks);
    expect(send).toHaveBeenCalledWith(Channels.PUBLISH_RENDER_LIVE_BLOCKS, expect.objectContaining({ blocks }));
    receiveLiveBlockResults(7, sentRequestId(send), [{ id: 'B0', ok: true, html: '<div/>' }]);
    await expect(p).resolves.toEqual([{ id: 'B0', ok: true, html: '<div/>' }]);
  });

  it('ignores an answer from a different window, and malformed results', async () => {
    const { win, send } = fakeWin(7);
    const p = windowLiveBlockRenderer(win)(blocks);
    const id = sentRequestId(send);
    receiveLiveBlockResults(8, id, [{ id: 'B0', ok: true, html: 'spoof' }]); // not the asked window
    receiveLiveBlockResults(7, id, [{ id: 'B0', ok: true }, { id: 'B1', ok: false, error: 'x' }, 'junk']);
    await expect(p).resolves.toEqual([{ id: 'B1', ok: false, error: 'x' }]);
  });

  it('fails cleanly when the window is gone, or never answers', async () => {
    await expect(windowLiveBlockRenderer(fakeWin(7, true).win)(blocks)).rejects.toThrow(/closed/);
    vi.useFakeTimers();
    const p = windowLiveBlockRenderer(fakeWin().win)(blocks);
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(LIVE_BLOCK_TIMEOUT_MS);
    expect(await caught).toMatch(/timed out/);
  });
});
