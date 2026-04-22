/**
 * External file drag-drop ingestion (#259).
 *
 * Accepts absolute paths the renderer resolved from a DataTransfer file
 * list (via Electron's `webUtils.getPathForFile`) and routes each through
 * the right pipeline:
 *
 *   - `.md` / `.ttl` / `.csv` → copy into the thoughtbase with a
 *     collision-rename (`foo.md`, `foo-2.md`, `foo-3.md`, …). The watcher
 *     picks the copy up and runs the usual index / CSV-register passes.
 *
 *   - `.pdf` → run through #94's `ingestPdf`, producing a Source under
 *     `.minerva/sources/<id>/`. The target folder is ignored for PDFs —
 *     Sources live in the sources library, not the file tree.
 *
 *   - Anything else → rejected with a short reason; the caller surfaces
 *     the rejections in a single toast.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafePath } from './fs';
import { ingestPdf } from '../sources/ingest-pdf';

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
}

/**
 * Import each local path into the thoughtbase. Failures are captured
 * per-file in `rejected` rather than thrown — one bad file in a multi-
 * drop shouldn't cancel the other imports.
 */
export async function dropImport(
  rootPath: string,
  targetFolder: string,
  localPaths: string[],
): Promise<DropImportResult> {
  const copied: CopiedFile[] = [];
  const ingestedPdfs: IngestedPdf[] = [];
  const rejected: RejectedFile[] = [];

  // Normalise the folder argument: '' (root) or a relative subdir.
  const relDir = targetFolder.replace(/^\/+|\/+$/g, '');

  for (const localPath of localPaths) {
    try {
      const ext = path.extname(localPath).toLowerCase();
      if (!ext) {
        rejected.push({ localPath, reason: 'Unknown file type (no extension)' });
        continue;
      }

      if (ext === '.pdf') {
        const result = await ingestPdf(rootPath, localPath);
        ingestedPdfs.push({
          localPath,
          sourceId: result.sourceId,
          duplicate: result.duplicate,
          title: result.title,
        });
        continue;
      }

      if (!COPY_EXTS.has(ext)) {
        rejected.push({
          localPath,
          reason: `Minerva doesn't ingest *${ext} files yet`,
        });
        continue;
      }

      const relativePath = await resolveDropName(
        rootPath,
        relDir,
        path.basename(localPath),
      );
      const destFull = assertSafePath(rootPath, relativePath);
      await fs.mkdir(path.dirname(destFull), { recursive: true });
      await fs.copyFile(localPath, destFull);
      copied.push({ localPath, relativePath });
    } catch (err) {
      rejected.push({
        localPath,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { copied, ingestedPdfs, rejected };
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
