/**
 * Offline cache for external `![](https://…)` images (#...).
 *
 * A remote image is fetched every time the note renders, so it's a broken-image
 * icon offline. This caches the bytes (keyed by a hash of the URL) under
 * `.minerva/cache/external-images/` on first (online) view, so later views —
 * including offline — serve it from disk. Lazy-on-view, mirroring the YouTube
 * poster cache: nothing is prefetched; a cache miss triggers a best-effort
 * download for next time.
 *
 * The renderer already fetches these same URLs when it draws the `<img>`, so
 * moving the fetch to main adds no new exposure. Guards: http(s) only, an
 * `image/*` content type, a size cap, and a timeout.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeFetch } from '../safe-fetch';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — skip oversized remote images.

export interface RemoteImage {
  bytes: Uint8Array;
  mime: string;
}

function cacheDir(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'cache', 'external-images');
}
/** Hash the URL to a stable, filesystem-safe cache key. */
function keyFor(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}
function bytesPath(rootPath: string, url: string): string {
  return path.join(cacheDir(rootPath), keyFor(url));
}
function mimePath(rootPath: string, url: string): string {
  return path.join(cacheDir(rootPath), `${keyFor(url)}.mime`);
}

/**
 * Return the bytes + mime for an external image URL: from the on-disk cache if
 * present, otherwise download, cache, and return. Returns `null` for a
 * non-http(s) URL, a non-image response, an oversized image, or any network
 * failure — the renderer keeps the remote `<img>` src as the fallback.
 */
export async function getOrFetchRemoteImage(rootPath: string, url: string): Promise<RemoteImage | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // https only (#2566): fetching http:// from main bypassed Chromium's Private
  // Network Access — a note's image could make main GET a LAN endpoint. The
  // renderer's CSP never loads http images either.
  if (parsed.protocol !== 'https:') return null;

  const bytesFile = bytesPath(rootPath, url);
  const mimeFile = mimePath(rootPath, url);
  try {
    const [bytes, mime] = await Promise.all([
      fs.readFile(bytesFile),
      fs.readFile(mimeFile, 'utf-8'),
    ]);
    return { bytes: new Uint8Array(bytes), mime: mime.trim() || 'application/octet-stream' };
  } catch {
    // Not cached yet — fall through to the network.
  }

  try {
    // safeFetch (#2566): no private/loopback destination, re-checked on every
    // redirect; timeout and size cap. A refusal is just "no cached copy".
    const res = await safeFetch(url, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_BYTES });
    if (!res.ok) return null;
    const mime = res.contentType.split(';')[0]!.trim();
    if (!mime.startsWith('image/')) return null; // don't cache HTML error pages etc.
    const result: RemoteImage = { bytes: res.bytes, mime };
    await fs.mkdir(cacheDir(rootPath), { recursive: true });
    await Promise.all([
      fs.writeFile(bytesFile, result.bytes),
      fs.writeFile(mimeFile, result.mime),
    ]);
    return result;
  } catch {
    return null;
  }
}
