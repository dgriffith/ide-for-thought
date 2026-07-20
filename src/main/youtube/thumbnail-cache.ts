/**
 * Offline poster-thumbnail cache for `youtube` fences (#...).
 *
 * The card's poster comes from `img.youtube.com`, so it's blank offline. This
 * caches the image under `.minerva/cache/youtube/<id>.jpg` on first (online)
 * view — thereafter the renderer serves it from disk, so it shows offline too.
 * Lazy-on-view: nothing is prefetched; the renderer calls this when it draws a
 * card, and a cache miss triggers a best-effort download for next time.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { thumbnailUrl } from '../../shared/youtube/youtube';

// A YouTube id is exactly 11 URL-safe base64 chars — validate before it reaches
// the filesystem so a crafted id can't escape the cache dir.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const FETCH_TIMEOUT_MS = 8000;

function cachePath(rootPath: string, id: string): string {
  return path.join(rootPath, '.minerva', 'cache', 'youtube', `${id}.jpg`);
}

/**
 * Return the thumbnail bytes for `id`: from the on-disk cache if present,
 * otherwise download from `img.youtube.com`, cache, and return them. Returns
 * `null` for an invalid id or when the download fails (offline + uncached) — the
 * renderer falls back to the remote `<img>` in that case.
 */
export async function getOrFetchThumbnail(rootPath: string, id: string): Promise<Uint8Array | null> {
  if (!ID_RE.test(id)) return null;
  const file = cachePath(rootPath, id);

  try {
    return new Uint8Array(await fs.readFile(file));
  } catch {
    // Not cached yet — fall through to the network.
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let bytes: Uint8Array;
    try {
      const res = await fetch(thumbnailUrl(id), { signal: controller.signal });
      if (!res.ok) return null;
      bytes = new Uint8Array(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    return bytes;
  } catch {
    // Offline / DNS / timeout — leave the card to the remote fallback.
    return null;
  }
}
