/**
 * Local audio/video recognition for inline media embeds (#908).
 *
 * A relative `![](clip.mp4)` in a note renders as an inline `<video>` / `<audio>`
 * player (renderer) and degrades to a link on export (main). Both sides classify
 * the path by extension here so they agree on what counts as media.
 */

export type MediaKind = 'audio' | 'video';

const VIDEO: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
};

const AUDIO: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  oga: 'audio/ogg',
  ogg: 'audio/ogg', // bare .ogg is overwhelmingly audio in practice
  flac: 'audio/flac',
  aac: 'audio/aac',
  opus: 'audio/ogg',
};

function extOf(rel: string): string {
  return rel.toLowerCase().match(/\.([^./\\]+)$/)?.[1] ?? '';
}

/** Which media element a path should render as, or null if it isn't audio/video. */
export function mediaKind(rel: string): MediaKind | null {
  const ext = extOf(rel);
  if (ext in VIDEO) return 'video';
  if (ext in AUDIO) return 'audio';
  return null;
}

/** MIME type for a media path — used as the `Blob` type so the player can decode. */
export function mediaMime(rel: string): string {
  const ext = extOf(rel);
  return VIDEO[ext] ?? AUDIO[ext] ?? 'application/octet-stream';
}
