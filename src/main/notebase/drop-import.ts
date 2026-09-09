/**
 * External file drag-drop ingestion (#259), extended for bulk ingest of zip
 * archives and picked folders (#2087).
 *
 * Accepts a list of `DropImportEntry` (an absolute local path plus an
 * optional POSIX-relative path preserving subfolder structure) and routes
 * each through the right pipeline:
 *
 *   - `.md` / `.ttl` / `.csv` → copy into the thoughtbase with a
 *     collision-rename (`foo.md`, `foo-2.md`, `foo-3.md`, …) applied to the
 *     leaf filename only. The watcher picks the copy up and runs the usual
 *     index / CSV-register passes.
 *
 *   - `.pdf` → run through #94's `ingestPdf`, producing a Source under
 *     `.minerva/sources/<id>/`. The target folder (and any `relativePath`)
 *     is ignored for PDFs — Sources live in the sources library, not the
 *     file tree.
 *
 *   - `.zip` → extract via `extractZipToTempDir` and recurse into the
 *     extracted entries (one nesting level deep only — a zip found inside
 *     another zip's contents is rejected rather than expanded).
 *
 *   - Anything else → rejected with a short reason; the caller surfaces
 *     the rejections in a single toast.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafePath } from './fs';
import { ingestPdf } from '../sources/ingest-pdf';
import { extractZipToTempDir } from './zip-extract';
import type { DropImportEntry } from './folder-walk';

export type { DropImportEntry } from './folder-walk';

/** Extensions we copy into the thoughtbase's note tree. */
const COPY_EXTS = new Set(['.md', '.ttl', '.csv']);

export interface CopiedFile {
  localPath: string;
  relativePath: string;
}

export interface IngestedPdf {
  localPath: string;
  sourceId: string;
  duplicate: boolean;
  title: string;
}

export interface RejectedFile {
  localPath: string;
  reason: string;
}

export interface DropImportResult {
  copied: CopiedFile[];
  ingestedPdfs: IngestedPdf[];
  rejected: RejectedFile[];
  /** True if any zip's entry count hit `MAX_BULK_INGEST_ENTRIES` during
   *  extraction — the archive (or the containing folder pick) may have
   *  more files than were actually processed. */
  capped: boolean;
}

/**
 * Dispatch one entry into the thoughtbase. Its ENTIRE body is wrapped in
 * try/catch, pushing to `acc.rejected` on any error and never throwing.
 *
 * This is deliberate, not incidental: once zip contents recurse through this
 * same function, an uncaught error deep in a zip's expansion would abort
 * every sibling still waiting in whichever `for` loop is currently
 * iterating — the top-level loop in `dropImport`, OR the recursive loop
 * over a zip's own extracted entries, OR (one level further) an ancestor
 * zip's remaining siblings. Catching here, before either loop ever sees an
 * exception, is what preserves "one bad file doesn't cancel the batch"
 * through the recursion.
 */
async function dispatchEntry(
  rootPath: string,
  targetFolder: string,
  entry: DropImportEntry,
  zipDepth: number,
  acc: DropImportResult,
): Promise<void> {
  try {
    const ext = path.extname(entry.localPath).toLowerCase();
    if (!ext) {
      acc.rejected.push({ localPath: entry.localPath, reason: 'Unknown file type (no extension)' });
      return;
    }

    if (ext === '.zip') {
      if (zipDepth >= 1) {
        acc.rejected.push({
          localPath: entry.localPath,
          reason: 'Nested zip archives are not supported',
        });
        return;
      }
      const zipStem = path.basename(entry.localPath, '.zip');
      const extracted = await extractZipToTempDir(entry.localPath);
      try {
        if (extracted.capped) acc.capped = true;
        const baseDir = entry.relativePath ? path.dirname(entry.relativePath) : '';
        const prefixDir = baseDir && baseDir !== '.' ? `${baseDir}/${zipStem}` : zipStem;
        for (const inner of extracted.entries) {
          // extractZipToTempDir's entries always come from enumerateFolderTree,
          // which always fills relativePath for anything it finds under
          // rootDir — the fallback to prefixDir alone only guards the type's
          // optionality (matches the identical pattern in
          // register-sources.ts's own directory-picker branch), it's never
          // actually hit.
          const innerRelative = inner.relativePath ? `${prefixDir}/${inner.relativePath}` : prefixDir;
          await dispatchEntry(
            rootPath,
            targetFolder,
            { localPath: inner.localPath, relativePath: innerRelative },
            zipDepth + 1,
            acc,
          );
        }
      } finally {
        await fs.rm(extracted.tmpDir, { recursive: true, force: true });
      }
      return;
    }

    if (ext === '.pdf') {
      const result = await ingestPdf(rootPath, entry.localPath);
      acc.ingestedPdfs.push({
        localPath: entry.localPath,
        sourceId: result.sourceId,
        duplicate: result.duplicate,
        title: result.title,
      });
      return;
    }

    if (!COPY_EXTS.has(ext)) {
      acc.rejected.push({
        localPath: entry.localPath,
        reason: `Minerva doesn't ingest *${ext} files yet`,
      });
      return;
    }

    // Normalise the folder argument: '' (root) or a relative subdir.
    const relDir = targetFolder.replace(/^\/+|\/+$/g, '');
    const fullRelPath = entry.relativePath ?? path.basename(entry.localPath);
    const combinedRelPath = relDir ? `${relDir}/${fullRelPath}` : fullRelPath;
    const lastSlash = combinedRelPath.lastIndexOf('/');
    const dir = lastSlash === -1 ? '' : combinedRelPath.slice(0, lastSlash);
    const base = lastSlash === -1 ? combinedRelPath : combinedRelPath.slice(lastSlash + 1);

    const relativePath = await resolveDropName(rootPath, dir, base);
    const destFull = assertSafePath(rootPath, relativePath);
    await fs.mkdir(path.dirname(destFull), { recursive: true });
    await fs.copyFile(entry.localPath, destFull);
    acc.copied.push({ localPath: entry.localPath, relativePath });
  } catch (err) {
    acc.rejected.push({
      localPath: entry.localPath,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Import each entry into the thoughtbase. Failures are captured per-entry
 * in `rejected` rather than thrown — one bad file (or one bad file buried
 * inside a zip) shouldn't cancel the other imports. See `dispatchEntry` for
 * why the try/catch lives there rather than around this loop.
 */
export async function dropImport(
  rootPath: string,
  targetFolder: string,
  entries: DropImportEntry[],
): Promise<DropImportResult> {
  const acc: DropImportResult = { copied: [], ingestedPdfs: [], rejected: [], capped: false };
  for (const entry of entries) {
    await dispatchEntry(rootPath, targetFolder, entry, 0, acc);
  }
  return acc;
}

/**
 * Pick a non-colliding destination filename under `relDir` for `baseName`.
 * `foo.md` → `foo.md` if free, else `foo-2.md`, `foo-3.md`, … until a
 * free slot is found. Capped at 1000 attempts to avoid an infinite loop
 * when something pathological is happening to the filesystem.
 */
export async function resolveDropName(
  rootPath: string,
  relDir: string,
  baseName: string,
): Promise<string> {
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  for (let i = 1; i <= 1000; i++) {
    const candidateName = i === 1 ? baseName : `${stem}-${i}${ext}`;
    const candidateRel = relDir ? `${relDir}/${candidateName}` : candidateName;
    const candidateFull = assertSafePath(rootPath, candidateRel);
    try {
      await fs.access(candidateFull);
      // Exists — try the next index.
    } catch {
      return candidateRel;
    }
  }
  throw new Error(`Could not find a free filename for '${baseName}' after 1000 attempts`);
}
