import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Read + `JSON.parse` a file, returning `fallback` ONLY when the file is absent
 * (ENOENT). A malformed-JSON parse error or any other read error is a genuine
 * failure and is rethrown, so it surfaces as an invoke rejection the caller can
 * see (#1631). This replaces the `try { readFile; JSON.parse } catch { return
 * fallback }` idiom, which silently conflated "not written yet" (expected) with
 * "corrupt on disk" (data loss the user should be told about). The IPC error
 * convention (see CLAUDE.md → IPC error handling) is: a sentinel/fallback marks
 * exactly ONE expected condition; real failures throw.
 *
 * Leaf module (only `node:fs/promises`) so it's unit-testable without pulling in
 * electron via the `helpers` barrel that re-exports it.
 */
export async function readJsonFileOr<T>(absPath: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(absPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
  return JSON.parse(raw) as T;
}

/**
 * `JSON.stringify` + write, atomically (#1915). Four call sites hand-rolled
 * `mkdir(recursive) + writeFile(JSON.stringify(x, null, 2))` with no crash
 * safety: a process death mid-`writeFile` (main crashes, the machine loses
 * power) leaves a truncated/partial file on disk — exactly the corruption
 * `readJsonFileOr` above correctly refuses to swallow, turning a transient
 * crash into a hard failure the user has to fix by hand.
 *
 * Writes to a sibling temp file first, then `rename`s it over the real path.
 * `rename` within the same directory is atomic on the filesystems Minerva
 * targets (POSIX same-volume rename, and NTFS via Node's implementation): a
 * reader either sees the old complete file or the new complete file, never a
 * partial write. The temp file is best-effort cleaned up on failure so a
 * crash doesn't leave litter behind, but that cleanup is not itself relied on
 * for correctness — only the rename is.
 */
export async function writeJsonFileAtomic(absPath: string, value: unknown): Promise<void> {
  const dir = path.dirname(absPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(absPath)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
    await fs.rename(tmpPath, absPath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
