/**
 * Image-upload helper for the editor (#455).
 *
 * Drag-and-drop and paste handlers in `Editor.svelte` route through
 * `uploadImage`: validate against the MIME allowlist, hash the bytes
 * for a stable filename, write to `.minerva/assets/inline/`, and
 * return the project-relative path the editor inserts as
 * `![alt](relative-path)` at the cursor.
 *
 * The hash-prefix shape (`<sha-prefix>-<safe-stem>.<ext>`) gives
 * content-addressed dedup for free: two drops of the same file
 * collapse to one asset on disk; pasting the same screenshot twice
 * doesn't grow the project.
 */

import { api } from '../ipc/client';

/** MIME allowlist. Anything not on this list is rejected with a
 *  toast — keeps the upload path scoped to images and avoids
 *  surprises with arbitrary binary blobs in the asset directory. */
export const ALLOWED_IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
]);

/** Per-file size cap. Matches the compute-output cap (#243) so the
 *  user has one mental model: 5MB and the asset goes through;
 *  bigger and they need to compress first. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Asset directory inside the project. `derived/` belongs to compute
 *  output; this dir is editor-attached uploads, kept separate so
 *  `.minerva/assets/inline/` doesn't collide with the
 *  `.minerva/assets/derived/` namespace. */
export const ASSET_DIR = '.minerva/assets/inline';

export type UploadResult =
  | { ok: true; relativePath: string; alt: string }
  | { ok: false; reason: 'too-large' | 'unsupported-mime' | 'empty' | 'write-failed'; detail?: string };

export interface UploadOptions {
  /** Original filename when available (drops carry it; clipboard items don't). */
  filename?: string;
  /** MIME hint when the File/Blob doesn't carry one. */
  mimeHint?: string;
}

/**
 * Validate, hash, write, and return the relative asset path to embed
 * in the editor. Caller handles toast feedback for the rejection
 * cases via the `reason` field.
 */
export async function uploadImage(
  file: Blob | File,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const mime = file.type || opts.mimeHint || '';
  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    return { ok: false, reason: 'unsupported-mime', detail: mime || 'unknown' };
  }
  if (file.size === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: 'too-large',
      detail: `${(file.size / 1024 / 1024).toFixed(1)} MB > ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)} MB`,
    };
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const ext = extensionFor(mime, opts.filename);
  const hash = await sha256Prefix(buf);
  const stem = sanitiseStem(opts.filename ?? 'image');
  const filename = `${hash}-${stem}.${ext}`;
  const relativePath = `${ASSET_DIR}/${filename}`;

  // Skip the write when an identical hash-prefixed file already
  // exists — dedup is the whole point of content addressing. The
  // existence check is cheap (single fs.stat) and avoids a redundant
  // disk write on a re-paste of the same screenshot.
  const exists = await api.notebase.fileExists(relativePath).catch(() => false);
  if (!exists) {
    try {
      await api.notebase.writeBinary(relativePath, buf);
    } catch (err) {
      return {
        ok: false,
        reason: 'write-failed',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { ok: true, relativePath, alt: opts.filename ?? '' };
}

/**
 * 12-hex-char prefix of SHA-256(content). Plenty of entropy for
 * within-project uniqueness without making filenames unreadable.
 */
async function sha256Prefix(bytes: Uint8Array): Promise<string> {
  // crypto.subtle.digest expects a strict ArrayBuffer-backed view.
  // The Uint8Array we already have IS that view, but the TS lib types
  // narrow `BufferSource` to ArrayBuffer-only — copy the bytes into a
  // fresh ArrayBuffer-backed view to satisfy the constraint without
  // the runtime cost of a deep copy in the engine (it's a memcpy on
  // an already-resident buffer).
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const hash = await crypto.subtle.digest('SHA-256', ab);
  const view = new Uint8Array(hash);
  let hex = '';
  for (let i = 0; i < 6; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Sanitise an arbitrary filename into a filesystem-safe stem.
 * Spaces and unsafe characters collapse to hyphens; the result is
 * lowercased so two drops of "Screen Shot.png" and "screen shot.png"
 * dedupe by hash prefix regardless of the user's case convention.
 */
function sanitiseStem(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '');
  const safe = stem.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'image';
}

/**
 * Filename extension for the asset on disk. Prefer the original
 * extension when the user dragged a real file (matches what they'd
 * expect to see in Finder); fall back to a MIME-derived extension
 * for clipboard pastes that ship without a name.
 */
function extensionFor(mime: string, filename: string | undefined): string {
  if (filename) {
    const m = filename.match(/\.([a-zA-Z0-9]+)$/);
    if (m) return m[1].toLowerCase();
  }
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    case 'image/svg+xml': return 'svg';
    case 'image/avif': return 'avif';
    default: return 'bin';
  }
}

/**
 * Compute the markdown-link path to embed in a note at `notePath`.
 * The asset lives at `assetRel` (project-rooted, e.g.
 * `.minerva/assets/inline/<file>.png`). Returns the path made
 * relative to the note's directory so `![](…)` resolves correctly
 * via the Preview's image hydration (#244).
 */
export function relativeAssetPathForNote(notePath: string, assetRel: string): string {
  const lastSlash = notePath.lastIndexOf('/');
  const noteDir = lastSlash > 0 ? notePath.slice(0, lastSlash) : '';
  if (!noteDir) return assetRel;
  const noteSegments = noteDir.split('/');
  const assetSegments = assetRel.split('/');
  let common = 0;
  while (
    common < noteSegments.length
    && common < assetSegments.length
    && noteSegments[common] === assetSegments[common]
  ) common++;
  const ups = noteSegments.length - common;
  const upParts: string[] = Array.from({ length: ups }, () => '..');
  const downs = assetSegments.slice(common);
  return [...upParts, ...downs].join('/');
}

/** Human-readable rejection messages for toast / status surfaces. */
export function rejectionMessage(result: Extract<UploadResult, { ok: false }>): string {
  switch (result.reason) {
    case 'too-large':
      return `Image too large to embed (${result.detail ?? '> 5MB'}).`;
    case 'unsupported-mime':
      return `Unsupported image type: ${result.detail ?? 'unknown'}. Use PNG, JPEG, GIF, WebP, SVG, or AVIF.`;
    case 'empty':
      return 'Empty image — nothing to embed.';
    case 'write-failed':
      return `Couldn't write image to project: ${result.detail ?? 'unknown error'}`;
  }
}
