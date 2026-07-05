/**
 * YouTube URL parsing + thumbnail helpers (#904).
 *
 * Tier 1 "click-to-open" embeds: a `youtube` fence's URL is parsed to a video
 * id here, the renderer draws a poster card (thumbnail + ▶) that opens the
 * video in the real browser on click, and the exporter degrades the same fence
 * to a linked thumbnail. Pure + shared so the renderer card, the export
 * pre-pass, and their tests all agree on what counts as a YouTube URL.
 *
 * Deliberately no network: the title/duration would need a YouTube API call,
 * which is exactly the phone-home this tier avoids. The thumbnail is a static
 * `img.youtube.com` URL the page loads only when the note is viewed.
 */

export interface YouTubeRef {
  /** The 11-character video id. */
  id: string;
  /**
   * Canonical watch URL — tracking params stripped, timestamp preserved. This
   * is what we hand to `shell.openExternal`, so it's normalized to a plain
   * `youtube.com/watch?v=…` form rather than echoing arbitrary query junk.
   */
  url: string;
  /** Start offset in seconds, when the source URL carried a `t=` / `start=`. */
  start?: number;
}

// A YouTube video id is exactly 11 chars of the URL-safe base64 alphabet.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Hosts we accept. `youtube-nocookie.com` is included so a privacy-embed URL a
// user pasted still resolves; `m.` / `www.` are normalized off before this set.
const WATCH_HOSTS = new Set(['youtube.com', 'youtube-nocookie.com']);

/**
 * Parse a YouTube URL into a `{ id, url, start? }`, or `null` if it isn't one
 * we recognize. Accepts the common shapes:
 *   - `youtube.com/watch?v=ID`
 *   - `youtu.be/ID`
 *   - `youtube.com/embed/ID`, `/shorts/ID`, `/live/ID`
 * and tolerates extra query params (`&t=`, `&list=`, …). A `t=` / `start=`
 * offset is preserved on the canonical URL so "start at 1:30" survives.
 */
export function parseYouTubeUrl(input: string): YouTubeRef | null {
  const raw = input.trim();
  if (!raw) return null;

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.replace(/^(www\.|m\.)/, '').toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0]!;
  } else if (WATCH_HOSTS.has(host)) {
    if (u.pathname === '/watch') {
      id = u.searchParams.get('v');
    } else {
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/]+)/);
      if (m) id = m[2]!;
    }
  }
  if (!id || !ID_RE.test(id)) return null;

  const start = parseStart(u.searchParams.get('t') ?? u.searchParams.get('start'));
  const url = start != null
    ? `https://www.youtube.com/watch?v=${id}&t=${start}s`
    : `https://www.youtube.com/watch?v=${id}`;
  return start != null ? { id, url, start } : { id, url };
}

/**
 * Parse a YouTube timestamp into seconds. Accepts bare seconds (`90`, `90s`)
 * and the colloquial `1h2m3s` / `2m30s` / `45s` forms. Returns undefined for
 * anything unrecognized or zero-length.
 */
function parseStart(t: string | null): number | undefined {
  if (!t) return undefined;
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return n > 0 ? n : undefined;
  }
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  const secs = (parseInt(m[1] ?? '0', 10) * 3600)
    + (parseInt(m[2] ?? '0', 10) * 60)
    + parseInt(m[3] ?? '0', 10);
  return secs > 0 ? secs : undefined;
}

/**
 * The poster thumbnail for a video id. `hqdefault.jpg` exists for every public
 * video (480×360), served over https so it loads under the renderer's
 * `img-src https:` without any CSP change.
 */
export function thumbnailUrl(id: string): string {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}
