/**
 * Renderer-side poster card for a `youtube` fence (#904, Tier 1).
 *
 * The fence rule in `Preview.svelte` calls `renderYouTubeFence` with the fence
 * body and splices the returned HTML straight into the preview. The card is an
 * `<a href>` so it's keyboard-focusable and Enter-activates for free; the
 * preview's delegated click handler intercepts `.youtube-embed`,
 * `preventDefault`s, and routes to `api.shell.openExternal` — nothing
 * third-party loads inside the renderer, so the CSP's `frame-src 'none'` stays
 * intact. (`will-navigate` in the main process would open the href externally
 * too, but handling it explicitly keeps the behavior testable and obvious.)
 *
 * The fence body is `<url>` on the first non-empty line, with any remaining
 * lines used as an optional caption — we can't fetch the real title without a
 * network round-trip, which this tier deliberately avoids.
 */

import { parseYouTubeUrl, thumbnailUrl } from '../../../shared/youtube/youtube';
import { escapeHtml, escapeAttr } from '../../../shared/text-escape';

/** Build the poster-card HTML for a `youtube` fence body, or an inline error
 *  if the URL doesn't parse as a YouTube video. */
export function renderYouTubeFence(body: string): string {
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const urlLine = lines[0] ?? '';
  const caption = lines.slice(1).join(' ').trim();

  const ref = parseYouTubeUrl(urlLine);
  if (!ref) {
    return `<div class="youtube-embed-error" role="alert">`
      + `<strong>Unrecognized YouTube URL</strong>`
      + `<pre>${escapeHtml(urlLine || body.trim())}</pre>`
      + `</div>`;
  }

  const thumb = thumbnailUrl(ref.id);
  const label = caption || 'Watch on YouTube';
  // `ref.url` and `thumb` are built from a validated 11-char id, so they carry
  // no user-controlled characters; `label` is user text and must be escaped.
  return `<a class="youtube-embed" href="${escapeAttr(ref.url)}" data-youtube-url="${escapeAttr(ref.url)}"`
    + ` target="_blank" rel="noopener noreferrer" title="${escapeAttr(label)} — opens in your browser">`
    + `<span class="youtube-embed-thumb">`
    // The remote `img.youtube.com` src is the immediate/offline fallback; the
    // preview's post-render pass swaps in a cached local copy (via
    // `data-youtube-id`) so the poster survives offline once viewed (#...).
    + `<img class="youtube-thumb" data-youtube-id="${escapeAttr(ref.id)}" src="${escapeAttr(thumb)}" alt="${escapeAttr(label)}" loading="lazy" />`
    + `<span class="youtube-embed-play" aria-hidden="true"></span>`
    + `</span>`
    + `<span class="youtube-embed-caption">`
    + `<span class="youtube-embed-label">${escapeHtml(label)}</span>`
    + `<span class="youtube-embed-host">youtube.com</span>`
    + `</span>`
    + `</a>`;
}

