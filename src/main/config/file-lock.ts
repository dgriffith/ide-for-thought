/**
 * Per-file serialization for async read-modify-write (#2416).
 *
 * An async store mutation is `read → modify → write` with an `await` between
 * each step. Two IPC calls against the same file interleave at those awaits:
 * both read the same old contents, each applies its own change, and the second
 * write replaces the first. Nothing errors; one update is simply gone. The
 * atomic write (#2369) does not help — it guarantees the file is never torn, not
 * that the right contents win.
 *
 * `withFileLock(absPath, fn)` runs `fn` only after every earlier call for the
 * same path has settled, so each read sees the previous write. Calls for
 * different paths do not wait for each other.
 *
 * Scope: one main process. A synchronous store (`recent-projects`,
 * `privileged-sites`, `compute/consent`) does not need this, because nothing
 * can run between its `readFileSync` and its `writeFileSync`. Another process
 * editing the file (the CLI, a text editor) is not covered either; nothing
 * short of an OS file lock would cover it.
 *
 * The map holds only IN-FLIGHT chains: the entry is removed when the last
 * queued call settles, so an idle app holds nothing, and closing a thoughtbase
 * leaves nothing behind. That is why this is a plain module map rather than a
 * `createProjectStore` slot (#2240): there is no per-project state to dispose.
 */
import path from 'node:path';

const tails = new Map<string, Promise<void>>();

export function withFileLock<T>(absPath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(absPath);
  const previous = tails.get(key) ?? Promise.resolve();
  // Run after the previous holder settles, whether it resolved or rejected:
  // one failed write must not wedge every later one.
  const result = previous.then(fn);
  const tail = result.then(
    () => undefined,
    (_err: unknown) => undefined, // the caller sees the rejection via `result`
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return result;
}

/** How many paths have a call queued or running. Test-only. */
export function _lockedPathCountForTests(): number {
  return tails.size;
}
