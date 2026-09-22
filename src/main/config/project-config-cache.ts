/**
 * The memo behind `readProjectConfig` (#2226).
 *
 * `readProjectConfig` is a `readFileSync` + `JSON.parse` of
 * `.minerva/config.json` with no memo at all, reached from ~40 call
 * expressions across main — `resolveDisplayName`, `getBibliographyStyleId`,
 * `getExcerptNoteFolder`, `getOnboardingDismissed`, the publish targets, and
 * `NOTEBASE_GET_PROPERTIES`'s `baseUri`.
 *
 * Measured rather than assumed, driving the real packaged app through the
 * preload bridge (probe + `tests/e2e` spec, since removed) on the
 * `sample-project` fixture — `readFileSync` calls on `.minerva/config.json`:
 *
 *                                        before   after
 *   project open (session restore)          3       3
 *   5 note saves                           +0      +0
 *   20 preview citation renders           +20      +0   ← one per render
 *   properties + excerpt folder + style    +3      +0
 *   setStyle then read it back             +2      +2
 *                                        ─────   ─────
 *                                          28       5
 *
 * The number of `readProjectConfig` CALLS is identical in both columns (25),
 * so this is the same flow doing the same work with the reads removed.
 *
 * Two things the issue gets wrong, worth recording so the next reader doesn't
 * re-derive them. **The call-site count is not the cost.** Thirty-eight call
 * expressions is accurate as a count of code locations (~41 by grep), but
 * opening a project costs three reads, not thirty-eight, and saving a note
 * costs none. And the loudest caller it names — `resolveDisplayName`, 17 of
 * those expressions — had already been memoized one commit earlier by #2221.
 *
 * What is left is **one** caller on a repeating path:
 * `citations/render-inline.ts`'s `getBibliographyStyleId`, which runs once per
 * `CITATION_RENDER_INLINE`, i.e. once per 120ms-debounced preview re-render in
 * any note that cites something. That is ~8 blocking reads a second while
 * typing, each ~15µs measured warm — so a five-minute editing session in a
 * cited note spends ~37ms of the main process's only thread re-reading a file
 * that did not change. Small, and worth saying plainly rather than dressing
 * up: this is a cheap removal of pure waste from the thread that also paints,
 * not a latency fix anyone will feel.
 *
 * ── Why a `statSync` and not a bare memo ────────────────────────────────────
 *
 * A bare memo is ~3000x faster than the read (0.005µs vs 15µs); validating
 * against `statSync` first is ~8x (1.87µs vs 15µs). Both numbers are far below
 * anything a user perceives, so the choice is made on correctness, not speed:
 * the stat means an edit made OUTSIDE the app — the user opening
 * `.minerva/config.json` in a text editor, a sync client, a restored backup,
 * a second install — is picked up on the very next read, with no invalidation
 * call having to exist anywhere. A stale config is a worse bug than a slow
 * one, and #2221 (the display-name memo one layer above this) already had to
 * reason carefully about exactly that; this layer removes the reasoning.
 *
 * The stat is taken BEFORE the read, deliberately. If a write lands between
 * the two, we cache NEW content under an OLD stamp, so the next call's stat
 * mismatches and re-reads — a wasted read, self-correcting. Stamping after the
 * read would cache OLD content under a NEW stamp, which is stale forever.
 *
 * Three independent guarantees, because none of them is sufficient alone:
 *
 *   1. **This app wrote it** — `patchRawProjectConfig` (the single writer of
 *      this file; `patchProjectConfig` and `graph/index.ts`'s `baseUri` both
 *      go through it) calls `invalidateProjectConfigCache()` after the write.
 *      Exact, and independent of filesystem timestamp granularity, which
 *      matters because the app does write-then-immediately-read
 *      (`setExcerptNoteFolder`, `upsertPublishTarget`).
 *   2. **Something outside wrote it** — the stamp below. `mtimeMs` is
 *      sub-millisecond on APFS/ext4/NTFS; `ctimeMs` and `size` are carried
 *      alongside so a rewrite that somehow lands in the same mtime tick still
 *      has to also preserve both.
 *   3. **A filesystem with coarse timestamps** (some SMB/network mounts stamp
 *      to the second) — `invalidateMenuInputCaches()` drops this on window
 *      `focus`, the same backstop #2221 established, and for the same reason:
 *      making an external edit means being in another application, so Minerva
 *      has to regain focus before the change can matter.
 *
 * `readRawProjectConfig` is deliberately NOT cached. It is the read half of
 * the read-modify-write in `patchRawProjectConfig`, it must THROW on a corrupt
 * file rather than default (#1891 — merging a patch onto a silently-emptied
 * `{}` is how "config is corrupt" became "config is gone"), and it runs once
 * per write rather than on any hot path. The two readers keep their different
 * failure contracts precisely because only the lenient one is memoized.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import { loadConfigFileSync, asRecord } from './config-store';

/** What the file looked like when the cached value was parsed from it. */
type Stamp = { mtimeMs: number; ctimeMs: number; size: number } | 'absent';

/**
 * ONE slot tagged with its `rootPath`, not a `Map<rootPath, …>` — the shape
 * `tests/architecture/project-state-registered.test.ts` (#2240) exists to keep
 * out of `src/main`, and `createProjectStore` isn't reachable here because
 * every caller is handed a bare path rather than a `ProjectContext` (several
 * of them, like `openNotebase`'s `resolveDisplayName`, name a directory that
 * is not an open project at all, so a project store could never dispose it).
 * Two windows on two different thoughtbases alternate and both miss; that case
 * then pays one `statSync` more than it does today, which is the honest cost
 * of not holding per-project state outside the registry.
 */
let memo: { rootPath: string; stamp: Stamp; value: Record<string, unknown> } | null = null;

/** Drop the memo. Called by `patchRawProjectConfig` (this app wrote the file)
 *  and by `invalidateMenuInputCaches()` (window focus). */
export function invalidateProjectConfigCache(): void {
  memo = null;
}

function configPath(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'config.json');
}

/** `null` means "couldn't stamp it" — an unexpected stat failure (EACCES, a
 *  path component that isn't a directory). Per CLAUDE.md's read policy only
 *  the *expected* condition (ENOENT) gets a sentinel; anything else falls
 *  through to `loadConfigFileSync`, which reports it, and is not cached. */
function stampOf(file: string): Stamp | null {
  try {
    const s = statSync(file);
    return { mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    return null;
  }
}

function sameStamp(a: Stamp, b: Stamp): boolean {
  if (a === 'absent' || b === 'absent') return a === b;
  return a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.size === b.size;
}

/**
 * Freeze the cached object, transitively.
 *
 * The pre-memo reader handed every caller its own throwaway parse, so a caller
 * that mutated the result harmed nobody. A memo hands out the SAME object to
 * all ~40 call sites, where the same mutation would silently corrupt what
 * every later reader sees. No current caller mutates (the two that look like
 * they might — `setOnboardingDismissed` and `setExcerptNoteFolder` — spread
 * into a fresh object, and `loadPublishState` maps into a new array), so this
 * costs nothing today; it exists so the next one fails loudly, at the write,
 * instead of quietly, somewhere else.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  return value;
}

/**
 * The project config as a raw record, from the memo when the file on disk is
 * byte-identical to the one it was parsed from. The returned object is frozen
 * and shared — treat it as read-only.
 */
export function readCachedProjectConfig(rootPath: string): Record<string, unknown> {
  const file = configPath(rootPath);
  const stamp = stampOf(file);
  if (stamp !== null && memo !== null && memo.rootPath === rootPath && sameStamp(memo.stamp, stamp)) {
    return memo.value;
  }
  const value = deepFreeze(
    loadConfigFileSync<Record<string, unknown>>(() => file, (raw) => asRecord(raw), {}),
  );
  // An unstampable file (stat failed for a reason that isn't ENOENT) can't be
  // validated, so it isn't cached — every call re-reads and re-reports, which
  // is what the uncached reader did.
  memo = stamp === null ? null : { rootPath, stamp, value };
  return value;
}
