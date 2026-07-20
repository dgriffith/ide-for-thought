/**
 * Offline metadata cache for `youtube` fences (#...) — the poster thumbnail and
 * the video title.
 *
 * Both would otherwise phone home every render (the poster from
 * `img.youtube.com`, the title via a lookup), which this tier avoids. Instead
 * we cache each once, lazily, on first (online) view: the poster bytes under
 * `.minerva/cache/youtube/<id>.jpg` and the title under `<id>.json`. Thereafter
 * the renderer serves them from disk, so the card reads well and shows its
 * poster offline. A cache miss triggers a best-effort fetch for next time.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { thumbnailUrl } from '../../shared/youtube/youtube';

// A YouTube id is exactly 11 URL-safe base64 chars — validate before it reaches
// the filesystem so a crafted id can't escape the cache dir.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const FETCH_TIMEOUT_MS = 8000;

function cacheDir(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'cache', 'youtube');
}
function cachePath(rootPath: string, id: string): string {
  return path.join(cacheDir(rootPath), `${id}.jpg`);
}
function titlePath(rootPath: string, id: string): string {
  return path.join(cacheDir(rootPath), `${id}.json`);
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

/**
 * Return the video title for `id`: from the on-disk cache if present, otherwise
 * from YouTube's public oEmbed endpoint (no API key), cached for next time.
 * Returns `null` for an invalid id or when the lookup fails — the card keeps its
 * caption / generic label in that case.
 */
export async function getOrFetchTitle(rootPath: string, id: string): Promise<string | null> {
  if (!ID_RE.test(id)) return null;
  const file = titlePath(rootPath, id);

  try {
    const cached = JSON.parse(await fs.readFile(file, 'utf-8')) as { title?: unknown };
    if (typeof cached.title === 'string') return cached.title;
  } catch {
    // Not cached yet — fall through to the network.
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let title: string | null = null;
    try {
      const watch = `https://www.youtube.com/watch?v=${id}`;
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`, {
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { title?: unknown };
      title = typeof data.title === 'string' && data.title.trim() ? data.title : null;
    } finally {
      clearTimeout(timer);
    }
    if (title == null) return null;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ title }));
    return title;
  } catch {
    return null;
  }
}
