/**
 * Flat recursive folder walk for bulk ingest (#2087).
 *
 * `dropImport` (drop-import.ts) used to only ever see a flat list of local
 * file paths — one per drag-dropped file. Bulk ingest hands it entries
 * discovered by walking a picked directory (or a zip's extracted contents,
 * see zip-extract.ts), so both producers share one walk primitive instead of
 * two hand-rolled directory recursions.
 *
 * Modeled on `readDirectory()` in `./fs.ts`: same recursive
 * `fs.readdir(dir, { withFileTypes: true })` + `isIgnoredEntry` shape, but
 * flattened into a list of `{ localPath, relativePath }` entries instead of
 * a `NoteFile` tree, and threaded through a cap counter so a maliciously (or
 * just enormously) large tree can't be walked without bound.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { isIgnoredEntry } from './ignored-dirs';

/** Upper bound on how many files a single bulk ingest (zip or folder) will
 *  process. Protects against a maliciously crafted archive (or an
 *  accidentally-huge folder pick) with an enormous entry count. */
export const MAX_BULK_INGEST_ENTRIES = 5000;

let maxBulkIngestEntries: number = MAX_BULK_INGEST_ENTRIES;

/** Test-only override, mirrors `_setPersistDebounceMsForTests` in
 *  `search/index.ts`. Pass `undefined` to restore the real default. */
export function _setMaxBulkIngestEntriesForTests(n: number | undefined): void {
  maxBulkIngestEntries = n ?? MAX_BULK_INGEST_ENTRIES;
}

export interface DropImportEntry {
  /** Absolute path on disk to read source bytes from. */
  localPath: string;
  /**
   * POSIX-separated path relative to the meaningful enclosing folder this
   * entry was found under — INCLUDING that folder's own name as the first
   * segment (e.g. a dropped `MyPapers/` folder's file is
   * `MyPapers/sub/file.md`, matching Finder's "expand into a named folder"
   * convention for zips too). Omitted for a flat single-file drop/pick with
   * no enclosing folder. Used only by drop-import's COPY_EXTS branch to
   * preserve subfolder structure; ingestPdf ignores it. Every producer of
   * this type is responsible for adding its own meaningful prefix —
   * enumerateFolderTree itself stays a bare, unprefixed primitive so its
   * meaning doesn't change depending on the caller (a picker's directory
   * branch prefixes with the picked folder's basename; zip extraction
   * prefixes with the zip's own stem — see drop-import.ts).
   */
  relativePath?: string;
}

export interface FolderWalkResult {
  entries: DropImportEntry[];
  capped: boolean;
}

/**
 * Flat recursive walk of `rootDir`. Reuses `isIgnoredEntry` (from
 * `./ignored-dirs`) for both files and directories — dotfiles and
 * `IGNORED_DIRS` are pruned, not just skipped-but-still-recursed-into, so a
 * file inside an ignored directory never appears in the result.
 *
 * Entries are relative to `rootDir` itself with NO prefix for `rootDir`'s
 * own name (see `DropImportEntry`'s doc comment for why).
 *
 * Stops early once `MAX_BULK_INGEST_ENTRIES` entries have been collected,
 * setting `capped: true` rather than throwing.
 */
export async function enumerateFolderTree(rootDir: string): Promise<FolderWalkResult> {
  const entries: DropImportEntry[] = [];
  const capped = await walk(rootDir, rootDir, entries);
  return { entries, capped };
}

/** Returns true once the cap has been hit (including mid-recursion). */
async function walk(dirPath: string, rootDir: string, out: DropImportEntry[]): Promise<boolean> {
  if (out.length >= maxBulkIngestEntries) return true;

  let dirEntries: import('node:fs').Dirent[];
  try {
    dirEntries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    // Race against deletion or a permission glitch mid-walk — treat as empty
    // rather than aborting the whole bulk ingest over one vanished subtree.
    return false;
  }

  for (const entry of dirEntries) {
    if (isIgnoredEntry(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (await walk(fullPath, rootDir, out)) return true;
      continue;
    }

    const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');
    out.push({ localPath: fullPath, relativePath });
    if (out.length >= maxBulkIngestEntries) return true;
  }

  return false;
}
