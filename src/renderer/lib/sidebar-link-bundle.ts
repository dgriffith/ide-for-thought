/**
 * Coalesced fetch for the right-sidebar link panels (#351).
 *
 * OutgoingLinksPanel and BacklinksPanel each used to fire their own IPC
 * on every `activeFilePath` change — two IPC round-trips per tab switch.
 * They both render at the same time and share the same active file, so
 * one IPC suffices: the main side returns both directions from the
 * same graph-state pass.
 *
 * This module memoizes per (path, revision) so a sibling panel that
 * mounts on the same change reuses the in-flight promise instead of
 * starting a second fetch. The cache holds at most one entry — a tab
 * switch invalidates whatever was there.
 */

import { api } from './ipc/client';
import type { OutgoingLink, Backlink } from '../../shared/types';

export interface LinkBundle {
  outgoing: OutgoingLink[];
  backlinks: Backlink[];
}

let cached: { key: string; promise: Promise<LinkBundle> } | null = null;

/** Fetch the link bundle for `relativePath` at the current `revision`.
 *  `revision` participates in the cache key so a global content change
 *  (e.g. a refactor that broadcasts NOTEBASE_REWRITTEN) invalidates
 *  every panel's view of the bundle. */
export function getLinkBundle(relativePath: string, revision: number): Promise<LinkBundle> {
  const key = `${revision}${relativePath}`;
  if (cached?.key === key) return cached.promise;
  const promise = api.links.bundle(relativePath);
  cached = { key, promise };
  return promise;
}

/** Drop the cache. Tests + the renderer (when project closes) call this. */
export function invalidateLinkBundle(): void {
  cached = null;
}
