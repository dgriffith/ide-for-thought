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
 */

/** How long after a file's modification its stamp can't yet be trusted: FAT's two seconds, the coarsest tick in use. */
export const STAMP_SETTLE_MS = 2000;

/** Whether a file last modified at `mtimeMs` may be cached by its stamp, judged at `nowMs`. */
export function stampSettled(mtimeMs: number, nowMs: number = Date.now()): boolean {
  return mtimeMs <= nowMs - STAMP_SETTLE_MS;
}
