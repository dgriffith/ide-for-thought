import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * True for a "no such file" error — the one filesystem failure a handler may
 * legitimately treat as an expected absence (CLAUDE.md → IPC error handling:
 * catch the SPECIFIC expected condition, let the rest throw). Anything else —
 * EACCES, EISDIR, EBUSY, a path-traversal refusal — is a real error (#2364).
 */
export function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

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
 * Leaf module (only `node:` builtins) so it's unit-testable without pulling in
 * electron via the `helpers` barrel that re-exports it.
 */
export async function readJsonFileOr<T>(absPath: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(absPath, 'utf-8');
  } catch (err) {
    if (isEnoent(err)) return fallback;
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
 *
 * Every JSON store in `src/main` writes through this or its sync twin below;
 * `tests/architecture/pattern-ratchets.test.ts` counts the writes that still
 * don't, and that count may only fall (#2369).
 */
export async function writeJsonFileAtomic(absPath: string, value: unknown, format: JsonFileFormat = {}): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmpPath = siblingTempPath(absPath);
  try {
    await fs.writeFile(tmpPath, serializeJson(value, format), fileOptions(format));
    await fs.rename(tmpPath, absPath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Synchronous twin of `writeJsonFileAtomic` — same temp-file-then-`rename`
 * guarantee — for the stores whose whole API is synchronous: `session.json`,
 * `recent-projects.json`, `privileged-sites.json`, and the
 * `.minerva/config.json` / `secrets.json` read-modify-writes, where staying
 * synchronous is also what keeps two patches from interleaving.
 */
export function writeJsonFileAtomicSync(absPath: string, value: unknown, format: JsonFileFormat = {}): void {
  fsSync.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmpPath = siblingTempPath(absPath);
  try {
    fsSync.writeFileSync(tmpPath, serializeJson(value, format), fileOptions(format));
    fsSync.renameSync(tmpPath, absPath);
  } catch (err) {
    try { fsSync.rmSync(tmpPath, { force: true }); } catch { /* best-effort, as above — never mask `err` */ }
    throw err;
  }
}

/**
 * How a store lays its JSON out on disk. The defaults — two-space indent, no
 * trailing newline — are what `writeJsonFileAtomic` always wrote; the options
 * exist so a store moving onto the atomic path keeps its file byte-for-byte
 * what it was (#2369): compact `session.json` / `recent-projects.json`, a
 * newline-terminated `menu-config.json` / `mcp-servers.json`.
 */
export interface JsonFileFormat {
  /** `JSON.stringify` indent; `0` writes compact single-line JSON. Default 2. */
  indent?: number;
  /** End the file with a newline. Default false. */
  trailingNewline?: boolean;
  /**
   * File permissions, e.g. `SECRET_FILE_MODE` for a store holding credentials
   * (#2562). Applied when the TEMP file is created — so the secret is never on
   * disk with wider permissions, not even between write and chmod — and the
   * rename carries it over, which also tightens an existing 0644 file on its
   * next write. Omitted: the process default (0666 & ~umask, usually 0644).
   */
  mode?: number;
}

/**
 * Owner read/write only, for stores that hold credentials (#2562): another
 * local user must not be able to read them, encrypted or not.
 */
export const SECRET_FILE_MODE = 0o600;

function fileOptions({ mode }: JsonFileFormat): { encoding: 'utf-8'; mode?: number } {
  return mode === undefined ? { encoding: 'utf-8' } : { encoding: 'utf-8', mode };
}

function serializeJson(value: unknown, { indent = 2, trailingNewline = false }: JsonFileFormat): string {
  const json = JSON.stringify(value, null, indent);
  return trailingNewline ? `${json}\n` : json;
}

/** In the same directory as `absPath`, so the final `rename` never crosses a volume. */
function siblingTempPath(absPath: string): string {
  return path.join(path.dirname(absPath), `.${path.basename(absPath)}.${randomBytes(6).toString('hex')}.tmp`);
}
