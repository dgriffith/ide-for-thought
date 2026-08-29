// Privileged-sites core type (#1912 — split out of shared/types.ts, where it
// sat inside the Conversations section despite being unrelated per-machine
// cookie-partition state). Owned on the main side by main/privileged-sites.ts.

/**
 * A site the user has authenticated to in an Electron persistent partition,
 * so Minerva-initiated fetches to that domain can carry their session.
 * Per-machine state — cookies live in userData under the partition.
 */
export interface PrivilegedSite {
  id: string;
  /** Bare hostname suffix to match against, e.g. `arxiv.org`. */
  domain: string;
  /** Optional human label; falls back to `domain`. */
  label: string;
  addedAt: string;
  /** ISO timestamp of the most recent in-app login window close. */
  lastLoginAt: string | null;
}
