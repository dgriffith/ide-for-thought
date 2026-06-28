/**
 * Export-time degrade for local audio/video embeds (#908).
 *
 * In the app a `![](clip.mp4)` renders an inline player. In an exported file
 * that's meaningless (and base64-inlining a video is a non-starter), so each
 * local-media image-ref degrades to a plain markdown **link** to the file — the
 * artifact still references it, and it survives the exporter's `html: false`.
 */

import { mediaKind } from '../../shared/media';

// `![alt](url)` or `![alt](url "title")` — same shape the image-inliner matches.
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Rewrite local-media image refs to links. Leaves real images, remote URLs, and
 *  non-media refs untouched. */
export function linkifyLocalMedia(markdown: string): string {
  return markdown.replace(MD_IMAGE_RE, (full, alt: string, url: string) => {
    if (/^(?:https?:|data:|blob:|file:|mailto:)/i.test(url) || url.startsWith('//')) return full;
    if (!mediaKind(url)) return full;
    const label = alt.trim() || url.split('/').pop() || url;
    return `[${label}](${url})`;
  });
}
