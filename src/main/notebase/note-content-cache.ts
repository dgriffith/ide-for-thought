/**
 * Bounded, mtime-validated cache of raw note bodies (perf #2220).
 *
 * Find-in-Notes re-runs a whole-corpus grep on a 200ms debounce, so typing a
 * seven-character query used to mean seven complete passes over every
 * indexable file. Measured on a 2,000-note / 11.6 MB corpus with a warm page
 * cache: **14,000 `readFile` calls** for the word, 2,000 per keystroke. The
 * bytes hadn't changed between any two of those passes — only the pattern had.
 *
 * So the read is cached and the *validation* is a `stat`, which is the cheaper
 * syscall by roughly 5x on this shape (a uniform-3KB control, 2,000 files:
 * 24ms of `stat` against 118ms of `readFile`). That is the whole trade: one
 * cheap syscall per file to avoid an expensive one.
 *
 * Same seven keystrokes after: **401 reads on a cold cache, 0 on a warm one**,
 * 1,242ms → 92ms → 57ms. Counts are the durable half of that — the timings
 * move several-fold with machine load, which is why the tests gate on counts.
 * The worst case, a rare pattern where the match cap never trips and every
 * file is visited every time, goes 14,000 reads / 859ms → 2,000 / 378ms cold
 * → 0 / 256ms warm. The one regression is a first-ever scan, which now pays a
 * `stat` it can't yet amortize: 125ms → 148ms, about 20%, once per file per
 * thoughtbase session.
 *
 * ── What invalidates, and why that list is short ────────────────────────────
 *
 * An entry is valid only while the file's `(mtimeNs, size)` pair is unchanged.
 * `stat` is taken with `bigint: true` for the nanosecond `mtimeNs` rather than
 * the float-millisecond `mtimeMs`: a millisecond-granularity stamp can collide
 * with a same-size rewrite inside the same tick, which is exactly the "search
 * silently shows the note's previous contents" failure this cache must not
 * introduce. Nanoseconds make that collision unreachable in practice.
 *
 * Deliberately NOT cached: the directory walk. The set of files is re-read
 * from disk on every scan, so a note created, renamed, or deleted a moment ago
 * is visited (or not) correctly on the very next keystroke — only the bytes of
 * files that still exist come from memory. A stale *file list* is the
 * dangerous cache here; a stale file *body* is fenced by the stat above. This
 * is also why nothing hooks the watcher: the watcher suppresses events for
 * paths an IPC handler already indexed (`notebase/path-dedup.ts`), so a
 * watcher-driven invalidation would have a hole exactly where in-app writes
 * happen. `stat` has no such hole — it sees every write from every source,
 * including edits made outside Minerva.
 *
 * ── Why admission control instead of LRU eviction ───────────────────────────
 *
 * The access pattern is a *cyclic sequential scan* in a deterministic order
 * (see `search-in-notes.ts`'s sorted walk). LRU and FIFO both degrade to a ~0%
 * hit rate on a cyclic scan larger than the cache — each insert evicts the
 * entry that will be wanted soonest, and a deterministic order makes that the
 * guaranteed case rather than the unlucky one. So once the budget is full this
 * cache stops admitting new entries: the first `MAX_CACHED_BYTES` of the
 * corpus stay resident and keep hitting, instead of every file missing. Memory
 * is bounded absolutely by the budget, not statistically.
 */

import fs from 'node:fs/promises';
import { createProjectStore } from '../project-store';
import { projectContext, type ProjectContext } from '../project-context-types';

/**
 * Resident note bytes per open thoughtbase. 64 MB is ~16,000 four-kilobyte
 * notes — comfortably past any thoughtbase we've seen, and a ceiling rather
 * than a target: the cache only reaches it if a corpus that large is actually
 * scanned.
 */
const MAX_CACHED_BYTES = 64 * 1024 * 1024;

interface Entry {
  /** `${mtimeNs}:${size}` — the identity the next stat must reproduce. */
  stamp: string;
  content: string;
  /** UTF-16 code units, the unit `String.length` bounds; close enough to bytes
   *  for a budget and far cheaper than re-encoding every body to measure it. */
  cost: number;
}

interface CacheState {
  entries: Map<string, Entry>;
  residentBytes: number;
}

/**
 * A `createProjectStore` slot rather than a module-level map (#2240): the
 * bodies of one thoughtbase's notes are per-project state, and closing a
 * thoughtbase should free up to 64 MB of them without `project-context.ts`
 * having to know this cache exists.
 */
const store = createProjectStore<CacheState>();

/** Test-only: drop everything (or one project's entries), so a test's read
 *  counts start from zero. A scoped hatch, not a general reset API — see
 *  CLAUDE.md's "mock the module, don't add a reset API" note (#1944). */
export function _clearNoteContentCacheForTests(rootPath?: string): void {
  const roots = rootPath === undefined ? store.keys() : [rootPath];
  for (const key of roots) void store.dispose(projectContext(key));
}

function stateFor(ctx: ProjectContext): CacheState {
  let state = store.get(ctx);
  if (!state) {
    state = { entries: new Map(), residentBytes: 0 };
    store.set(ctx, state);
  }
  return state;
}

function drop(state: CacheState, key: string): void {
  const entry = state.entries.get(key);
  if (!entry) return;
  state.residentBytes -= entry.cost;
  state.entries.delete(key);
}

/**
 * Read one note's text, serving it from memory when the file is byte-identical
 * to the cached copy. Returns `null` when the file can't be read at all — the
 * scan skips it, the same as the uncached `try { readFile } catch { continue }`
 * this replaces.
 *
 * Takes `rootPath` + `absPath` rather than a `ProjectContext` because its only
 * caller, `searchInNotes`, is reached from three places that between them hold
 * a raw root string, a tool context and a real `ProjectContext` — the branding
 * helper exists for exactly that boundary.
 */
export async function readNoteCached(rootPath: string, absPath: string): Promise<string | null> {
  const state = stateFor(projectContext(rootPath));

  let stamp: string;
  try {
    const st = await fs.stat(absPath, { bigint: true });
    stamp = `${st.mtimeNs}:${st.size}`;
  } catch {
    // Gone, unreadable, or a race with a delete. Dropping the entry is a BUDGET
    // property, not a freshness one — a file recreated at this path gets a new
    // stamp and is re-read regardless. Without it, a deleted note's bytes would
    // hold their slice of the 64 MB until the thoughtbase closed.
    drop(state, absPath);
    return null;
  }

  const hit = state.entries.get(absPath);
  if (hit && hit.stamp === stamp) return hit.content;

  let content: string;
  try {
    content = await fs.readFile(absPath, 'utf-8');
  } catch {
    drop(state, absPath);
    return null;
  }

  // Replace in place. A file that grew past the budget loses its slot rather
  // than pushing the total over it.
  drop(state, absPath);
  const cost = content.length;
  if (state.residentBytes + cost <= MAX_CACHED_BYTES) {
    state.entries.set(absPath, { stamp, content, cost });
    state.residentBytes += cost;
  }
  return content;
}
