/**
 * When a file's stat stamp (`size` + `mtime`) can stand in for its content
 * (#2178). A cache that serves a file's bytes, or something derived from them,
 * while the stamp is unchanged is only right if a rewrite always moves the
 * stamp — and one that lands in the same timestamp tick, at the same size,
 * doesn't. Nanosecond fields don't save it: the clock behind them is coarse.
 * Linux stamps from a clock that ticks every few milliseconds, Windows' ticks
 * every ~15.6 ms, and FAT/exFAT (a USB stick) records whole two-second steps.
 * macOS's APFS is the exception, which is why the caches looked sound until
 * the suite first ran on Linux.
 *
 * The rule is git's "racily clean" one: a file modified too recently to be
 * told apart from its next same-size rewrite isn't trusted by its stamp — the
 * caller reads it, and doesn't cache what it read. Once the modification is
 * older than the coarsest tick, the stamp is reliable again. Only files
 * touched in the last couple of seconds pay for it, with one extra read.
 *
 * Used where a stale read is the only thing standing between the user and a
 * wrong answer (the note-content cache, the orphaned-asset scan). Not where
 * something else already invalidates (the project-config memo's writer hook,
 * the CSV row counts' watcher), where an unchanged stamp is meant to read as
 * "nothing to do" (plugins-apply's fingerprint), or where the cached object's
 * identity carries state (the thoughtbase shapes, whose stopped checks are
 * recorded against the parsed file, #2874).
 */

/** How long after a file's modification its stamp can't yet be trusted: FAT's two seconds, the coarsest tick in use. */
export const STAMP_SETTLE_MS = 2000;

/** Whether a file last modified at `mtimeMs` may be cached by its stamp, judged at `nowMs`. */
export function stampSettled(mtimeMs: number, nowMs: number = Date.now()): boolean {
  return mtimeMs <= nowMs - STAMP_SETTLE_MS;
}
