/**
 * The clip payload the extension sends to Minerva's loopback endpoint — the
 * shape `POST /ingest` expects (mirrors `ClipperPayload` in the app's
 * `clipper-server.ts`). Pure + framework-free so it's unit-testable.
 */

export interface ClipPayload {
  url: string;
  html: string;
  pageTitle: string;
  selection?: string | undefined;
  /** User tags from the popup (#793). */
  tags?: string[] | undefined;
  /** Free-text note from the popup (#793). */
  note?: string | undefined;
}

/** Normalise a raw selection: trimmed, or `undefined` when empty. */
export function normalizeSelection(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Parse the popup's free-text tag field into a clean, de-duplicated list.
 * Tags are separated by commas or whitespace; a leading `#` is tolerated.
 */
export function parseTags(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const part of (raw ?? '').split(/[,\s]+/)) {
    const tag = part.replace(/^#+/, '').trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}
