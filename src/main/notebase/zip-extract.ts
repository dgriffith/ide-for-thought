/**
 * Zip archive extraction for bulk ingest (#2087).
 *
 * Extracts an untrusted `.zip` into a fresh scratch directory so its
 * contents can be flat-walked and dispatched through the same
 * `dropImport` pipeline as a picked folder. Every step here is
 * security-load-bearing — this is untrusted input:
 *
 *   - the whole file is buffered into memory by `JSZip.loadAsync`, so a
 *     size ceiling is enforced BEFORE that call, not after;
 *   - zip-slip (an entry whose name escapes the extraction directory via
 *     `../` or an absolute path) is checked for EVERY entry before ANY
 *     entry is written, and the whole archive is rejected — not just the
 *     offending entry — if one is found;
 *   - the same `isIgnoredEntry` filter the folder walk uses keeps a zip
 *     containing a `.git` directory (or any dotfile) from materializing
 *     its contents on disk;
 *   - the entry-count cap is enforced DURING extraction, not discovered
 *     afterward — a zip can claim millions of tiny entries without being
 *     anywhere near the byte-size ceiling.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { assertSafePath } from './fs';
import { isIgnoredEntry } from './ignored-dirs';
import { enumerateFolderTree, getMaxBulkIngestEntries, type DropImportEntry } from './folder-walk';

let maxZipBytesForTests: number | undefined;

/** Upper bound on the on-disk size of a zip we'll attempt to extract.
 *  `JSZip.loadAsync` buffers the entire file into memory, so this check
 *  must run before that call rather than after. */
export const MAX_ZIP_BYTES = 500 * 1024 * 1024; // 500MB

/** Test-only override so a size-ceiling test doesn't need a real 500MB file. */
export function _setMaxZipBytesForTests(n: number | undefined): void {
  maxZipBytesForTests = n;
}

function maxZipBytes(): number {
  return maxZipBytesForTests ?? MAX_ZIP_BYTES;
}

export interface ZipExtractResult {
  tmpDir: string;
  entries: DropImportEntry[];
  capped: boolean;
}

/**
 * Extracts `zipAbsPath` into a fresh scratch dir, then flat-walks the result
 * via `enumerateFolderTree` rather than re-implementing filtering.
 *
 * Caller owns cleanup of `tmpDir` on the SUCCESS path (e.g.
 * `fs.rm(tmpDir, { recursive: true, force: true })` in a `finally`). On any
 * failure DURING extraction itself, this function cleans up its own tmpDir
 * before rethrowing — a caller never sees a leaked tmpDir from a failed call.
 */
export async function extractZipToTempDir(zipAbsPath: string): Promise<ZipExtractResult> {
  const stat = await fsp.stat(zipAbsPath);
  if (stat.size > maxZipBytes()) {
    throw new Error(
      `Zip archive is too large to extract (${stat.size} bytes exceeds the ${maxZipBytes()}-byte limit)`,
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-zip-import-'));
  try {
    const buffer = await fsp.readFile(zipAbsPath);
    const zip = await JSZip.loadAsync(buffer);

    const fileEntries = Object.values(zip.files).filter((entry) => !entry.dir);

    // Zip-slip protection: validate every entry's destination BEFORE writing
    // anything. If any entry fails, reject the WHOLE archive rather than
    // salvaging the non-malicious entries.
    const destinations = new Map<string, string>();
    for (const entry of fileEntries) {
      let destPath: string;
      try {
        destPath = assertSafePath(tmpDir, entry.name);
      } catch {
        throw new Error(`Refusing to extract zip: entry '${entry.name}' escapes the archive root`);
      }
      destinations.set(entry.name, destPath);
    }

    let capped = false;
    let extractedCount = 0;
    for (const entry of fileEntries) {
      if (extractedCount >= getMaxBulkIngestEntries()) {
        capped = true;
        break;
      }
      // Skip entries under an ignored directory / dotfile segment (same
      // filter the folder walk uses), so a zip containing `.git/` doesn't
      // materialize its contents on disk.
      const segments = entry.name.split('/').filter(Boolean);
      if (segments.some((seg) => isIgnoredEntry(seg))) continue;

      const destPath = destinations.get(entry.name)!;
      const buf = await entry.async('nodebuffer');
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await fsp.writeFile(destPath, buf);
      extractedCount++;
    }

    const walkResult = await enumerateFolderTree(tmpDir);
    return {
      tmpDir,
      entries: walkResult.entries,
      capped: capped || walkResult.capped,
    };
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
}
