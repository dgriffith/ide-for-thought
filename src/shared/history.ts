/**
 * Local per-note history (#1158) — shared types across the main store, the IPC
 * contract, and the renderer History panel.
 */

/** How a revision came to exist. `proposal` is populated when an AI-applied
 *  write produces a revision — the cheap #1159 guardrail so a future
 *  provenance-over-time view can correlate note history with gate events. */
export type RevisionOrigin = 'edit' | 'restore' | 'proposal';

export interface RevisionMeta {
  /** Epoch millis the revision was captured (also its stable id). */
  ts: number;
  origin: RevisionOrigin;
  /** Optional version tag; labeled revisions are exempt from pruning. Stored
   *  from day one so tagging is a UI-only add later, never a migration. */
  label?: string;
}
