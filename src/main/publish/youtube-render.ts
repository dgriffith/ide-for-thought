/**
 * Export-time degrade for `youtube` fences (#904).
 *
 * In the app a `youtube` fence renders an interactive poster card whose click
 * opens the browser (youtube-embed.ts). That DOM is meaningless in an exported
 * file, so on export each fence becomes a plain linked thumbnail —
 * `[![caption](thumb.jpg)](watch-url)` — which survives the exporter's
 * `html: false` markdown-it (it's an image wrapped in a link, no raw HTML) and
 * stays click-to-open for a reader viewing the artifact online.
 *
 * Synchronous, unlike the Vega pre-pass: there's no library to load and no
 * rendering to do, just URL parsing. A fence whose URL doesn't parse degrades
 * to an italic note rather than a broken image.
 */

import { parseYouTubeUrl, thumbnailUrl } from '../../shared/youtube/youtube';

// A fenced ```youtube block at line start. Mirrors VEGA_FENCE_RE in
// vega-render.ts so the two pre-passes recognize fences identically.
const YOUTUBE_FENCE_RE = /^```youtube[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

/** Cheap gate: does this markdown contain any `youtube` fence? */
export function hasYouTubeBlocks(markdown: string): boolean {
  YOUTUBE_FENCE_RE.lastIndex = 0;
  return YOUTUBE_FENCE_RE.test(markdown);
}

/**
 * Replace every `youtube` fence with a linked-thumbnail markdown image. Returns
 * the input unchanged when there are no such fences.
 */
export function renderYouTubeBlocks(markdown: string): string {
  if (!hasYouTubeBlocks(markdown)) return markdown;

  YOUTUBE_FENCE_RE.lastIndex = 0;
  return markdown.replace(YOUTUBE_FENCE_RE, (_full, body: string) => renderOne(body));
}

function renderOne(body: string): string {
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const urlLine = lines[0] ?? '';
  const caption = lines.slice(1).join(' ').trim();

  const ref = parseYouTubeUrl(urlLine);
  if (!ref) {
    return `*Video could not be embedded: unrecognized YouTube URL (${escapeMd(urlLine || body.trim())}).*`;
  }

  const alt = caption || 'Watch on YouTube';
  return `[![${escapeMd(alt)}](${thumbnailUrl(ref.id)})](${ref.url})`;
}

/** Escape the characters that would break out of the `![alt](url)` syntax. */
function escapeMd(s: string): string {
  return s.replace(/([[\]()\\])/g, '\\$1');
}
