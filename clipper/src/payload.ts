/**
 * The clip payload the extension sends to Minerva's loopback endpoint — the
 * shape `POST /ingest` expects (mirrors `ClipperPayload` in the app's
 * `clipper-server.ts`). Pure + framework-free so it's unit-testable.
 */

export interface ClipPayload {
  url: string;
  html: string;
  pageTitle: string;
  selection?: string;
}

/** Normalise a raw selection: trimmed, or `undefined` when empty. */
export function normalizeSelection(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}
