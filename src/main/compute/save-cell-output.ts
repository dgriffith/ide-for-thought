/**
 * Save the output of a compute cell as a first-class note with
 * provenance frontmatter (#244).
 *
 * Injects a stable `{id=…}` into the source fence (idempotent — reuses
 * the existing id on re-save) and writes a derived note with a
 * backlink pointing at `[[source-note#cell-<id>]]`, so the derived
 * note surfaces on the source's backlinks panel.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import * as notebaseFs from '../notebase/fs';
import {
  findRunnableFences,
  codeOf,
  type FenceRange,
} from '../../renderer/lib/editor/output-block';
import {
  ensureCellId,
  rewriteFenceInfo,
  parseFenceInfo,
} from '../../shared/compute/cell-id';
import {
  buildDerivedNote,
  defaultDerivedNotePath,
} from '../../shared/compute/derived-note';
import type { CellOutput } from '../../shared/compute/types';

export interface SaveCellOutputInput {
  /** Relative path of the note that owns the source cell. */
  sourcePath: string;
  /** Fence language (`sparql`, `sql`, …) — disambiguates the fence in the source. */
  cellLanguage: string;
  /** Exact cell body, used to find the matching fence in the current source doc. */
  cellCode: string;
  /** The output to serialise. */
  output: CellOutput;
  /** Destination relative path. When omitted, a sensible default under `notes/derived/` is chosen. */
  destPath?: string;
  /** Optional explicit title; default is `<source-stem> — cell <id>`. */
  title?: string;
}

export interface SaveCellOutputResult {
  /** Relative path where the derived note was written. */
  derivedPath: string;
  /** The cell id used (newly generated or pre-existing). */
  cellId: string;
  /** True when this save had to inject a new id into the source fence. */
  injectedId: boolean;
}

export async function saveCellOutput(
  rootPath: string,
  input: SaveCellOutputInput,
): Promise<SaveCellOutputResult> {
  // Re-read the source doc to find the fence. Matching by (language, exact
  // code) is the same heuristic the editor extension uses when applying an
  // output-block edit after an awaited run.
  const sourceContent = await notebaseFs.readFile(rootPath, input.sourcePath);
  const allowed = new Set([input.cellLanguage.toLowerCase()]);
  const fence = findRunnableFences(sourceContent, allowed).find(
    (f) => codeOf(sourceContent, f) === input.cellCode,
  );
  if (!fence) {
    throw new Error(
      `Could not locate the ${input.cellLanguage} cell in ${input.sourcePath}. ` +
      `The cell body may have changed since the output was produced.`,
    );
  }

  // Ensure the fence carries a stable id, rewriting the source doc if we
  // had to mint one. Re-saves against an already-annotated cell reuse
  // the existing id.
  const fenceInfo = extractFenceInfo(sourceContent, fence);
  const { id: cellId, newInfo, wasNew } = ensureCellId(fenceInfo);
  if (wasNew) {
    const rewritten = rewriteFenceInfo(sourceContent, fence.startOffset, newInfo);
    await notebaseFs.writeFile(rootPath, input.sourcePath, rewritten);
  }

  const derivedPath = input.destPath ?? defaultDerivedNotePath(input.sourcePath, cellId);
  const markdown = buildDerivedNote({
    title: input.title,
    output: input.output,
    sourcePath: input.sourcePath,
    cellId,
  });

  const destFull = path.join(rootPath, derivedPath);
  await fs.mkdir(path.dirname(destFull), { recursive: true });
  await fs.writeFile(destFull, markdown, 'utf-8');

  return { derivedPath, cellId, injectedId: wasNew };
}

/**
 * Pull the info string (everything after the opening backticks on the
 * fence's first line) so we can run it through the cell-id helpers.
 */
function extractFenceInfo(doc: string, fence: FenceRange): string {
  const lineEnd = doc.indexOf('\n', fence.startOffset);
  const stop = lineEnd < 0 ? doc.length : lineEnd;
  const line = doc.slice(fence.startOffset, stop);
  const m = line.match(/^`{3,}(.*)$/);
  return m ? m[1] : '';
}

// Re-export for type-checkers that prefer a named symbol over the
// structural import through `parseFenceInfo`.
export { parseFenceInfo };
