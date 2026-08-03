import fs from 'node:fs/promises';

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
