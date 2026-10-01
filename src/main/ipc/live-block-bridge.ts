/**
 * The window side of a live-block render (#2510): ask the window that started
 * an export to render a batch of live blocks with the preview's own
 * components, and wait for its answer.
 *
 * A request/response over two channels — `publish:renderLiveBlocks` (event,
 * main → that window) and `publish:liveBlocksRendered` (invoke, its reply).
 * An answer is accepted only from the window that was asked and only once;
 * a window that closes, never answers, or answers garbage costs the export
 * its views (each degrades to a note — see `publish/live-blocks.ts`), never
 * the export itself. It lives in `ipc/`, not `publish/`: it is IPC glue, and
 * `publish/` importing `ipc/` would make the two packages a cycle (#2238).
 */
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';
import type { LiveBlockResult } from '../../shared/live-blocks';
import { broadcast } from './broadcast';
import type { LiveBlockRenderer } from '../publish/live-blocks';

/** Generous: a batch renders one block at a time, each awaiting its data. */
export const LIVE_BLOCK_TIMEOUT_MS = 60_000;

interface Pending {
  senderId: number;
  resolve: (results: LiveBlockResult[]) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<string, Pending>();

/** A renderer bound to `win`: each call sends one batch and awaits the reply. */
export function windowLiveBlockRenderer(win: BrowserWindow): LiveBlockRenderer {
  return (blocks) => new Promise((resolve, reject) => {
    if (win.isDestroyed()) {
      reject(new Error('the window that started this export was closed'));
      return;
    }
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('rendering timed out'));
    }, LIVE_BLOCK_TIMEOUT_MS);
    timer.unref?.();
    pending.set(requestId, { senderId: win.webContents.id, resolve, timer });
    broadcast(win, Channels.PUBLISH_RENDER_LIVE_BLOCKS, { requestId, blocks });
  });
}

/**
 * The window's reply. Ignored unless it answers an open request from the same
 * window; results are shape-checked, since they cross a process boundary.
 */
export function receiveLiveBlockResults(senderId: number, requestId: string, results: unknown): void {
  const p = pending.get(requestId);
  if (!p || p.senderId !== senderId) return;
  pending.delete(requestId);
  clearTimeout(p.timer);
  p.resolve(Array.isArray(results) ? results.filter(isResult) : []);
}

function isResult(r: unknown): r is LiveBlockResult {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  if (typeof o.id !== 'string') return false;
  return o.ok === true ? typeof o.html === 'string' : o.ok === false && typeof o.error === 'string';
}
