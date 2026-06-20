/**
 * Clipper server lifecycle (#222 → #790).
 *
 * One loopback server per app run, started when a thoughtbase opens and torn
 * down when the last one closes. Idempotent start (concurrent project opens
 * race harmlessly); the shared secret is generated once and held for the run,
 * so a stop/start keeps pairing stable.
 *
 * Enable gate: `isClipperEnabled()` currently reads an env flag and defaults
 * OFF, so a normal run opens no port. #791 replaces this with the persisted
 * "enable browser clipper" setting + the Settings/pairing UI that surfaces the
 * port + secret this module already exposes via `getClipperInfo()`.
 */

import { startClipperServer, type ClipperServerHandle } from './clipper-server';
import { clipperIngest } from './clipper-ingest';
import { getClipperConfig, ensureClipperSecret } from './clipper-config';

/** Preferred loopback port; falls back to an ephemeral one if taken. */
const PREFERRED_PORT = 41599;

let handle: ClipperServerHandle | null = null;
let starting: Promise<ClipperServerHandle> | null = null;

export interface ClipperInfo {
  port: number;
  secret: string;
}

/** Whether the clipper is enabled — the persisted Settings toggle (#791). */
export async function isClipperEnabled(): Promise<boolean> {
  return (await getClipperConfig()).enabled;
}

/**
 * Ensure the loopback server is running, returning its port + secret.
 * Idempotent and concurrency-safe. Uses the persisted secret so a paired
 * extension survives restarts.
 */
export async function ensureClipperRunning(
  resolveRootPath: () => string | null,
): Promise<ClipperInfo> {
  if (handle) return { port: handle.port, secret: handle.secret };
  if (!starting) {
    starting = ensureClipperSecret()
      .then((secret) => startClipperServer({
        secret,
        resolveRootPath,
        ingest: clipperIngest,
        port: PREFERRED_PORT,
      }))
      .then((h) => {
        handle = h;
        starting = null;
        return h;
      })
      .catch((err) => {
        starting = null;
        throw err;
      });
  }
  const h = await starting;
  return { port: h.port, secret: h.secret };
}

/** Stop the server if running. Safe to call when it isn't. */
export async function stopClipperServer(): Promise<void> {
  const h = handle;
  handle = null;
  if (h) await h.close();
}

/** Current port + secret, or null when not running. Surfaced by #791's UI. */
export function getClipperInfo(): ClipperInfo | null {
  return handle ? { port: handle.port, secret: handle.secret } : null;
}
