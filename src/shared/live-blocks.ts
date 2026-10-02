/**
 * Live blocks in exports (#2508): the protocol between the export pipeline
 * (main) and the window that renders them with the preview's own components
 * (#2510). Pure types + constants, shared by both processes.
 */

/** Block kinds the export asks a window to render. Grows per #2508 child. */
export type LiveBlockKind = 'object-view' | 'query';

export interface LiveBlockRequest {
  /** Unique within one request batch. */
  id: string;
  kind: LiveBlockKind;
  /** The block's own text — the fence body, exactly as the preview reads it. */
  source: string;
  /** The note the block sits in (thoughtbase-relative). */
  notePath: string;
}

/** A rendered block is self-contained static HTML (its own scoped <style>);
 *  a failure carries a message the export shows in its place. */
export type LiveBlockResult =
  | { id: string; ok: true; html: string }
  | { id: string; ok: false; error: string };

/** Class on every rendered block's wrapper; the block's CSS is scoped under it. */
export const LIVE_BLOCK_CLASS = 'minerva-live-block';

/** Attribute a rendered block puts on each element that should link to a note
 *  (value: the note's thoughtbase-relative path). The export resolves it
 *  through its link policy — an `href`, or no link at all. */
export const NOTE_LINK_ATTR = 'data-note-link';
