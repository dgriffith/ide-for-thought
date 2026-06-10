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
} from '../../shared/compute/fences';
import {
  ensureCellId,
  rewriteFenceInfo,
  parseFenceInfo,
  hasPinFlag,
  setPinFlag,
} from '../../shared/compute/cell-id';
import {
  buildDerivedNote,
  defaultDerivedNotePath,
} from '../../shared/compute/derived-note';
import type { CellOutput } from '../../shared/compute/types';
import { findDerivedNoteForCell } from '../graph/index';
import { projectContext } from '../project-context-types';

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
  /**
   * Pin to notebook (#244). When true, the saver:
   *   1. Looks up the existing derived note for this cell via the
   *      graph (prov:wasDerivedFrom + thought:derivedFromCell). If
   *      found, uses that path as the destination — `destPath` is
   *      ignored.
   *   2. After the write succeeds, sets `pin=true` on the source
   *      cell's fence info string so future saves reuse the same
   *      destination automatically.
   * The flag is also implicitly true when the source cell already
   * carries `pin=true` from a prior Pin operation; callers can omit
   * the flag and the saver still honours the existing pin.
   */
  pin?: boolean;
  /**
   * Set by the renderer after the user confirmed an overwrite. When
   * the destination exists, on-disk content differs from the new
   * derived note, and this flag is unset, the saver returns a
   * `needs-confirm` result instead of writing — the renderer prompts
   * the user, then calls again with `forceOverwrite: true`.
   */
  forceOverwrite?: boolean;
}

/** Successful write — the derived note (and any assets) landed at `derivedPath`. */
export interface SaveCellOutputWritten {
  status: 'written';
  /** Relative path where the derived note was written. */
  derivedPath: string;
  /** The cell id used (newly generated or pre-existing). */
  cellId: string;
  /** True when this save had to inject a new id into the source fence. */
  injectedId: boolean;
  /** True when this save set / kept the pin flag on the source fence. */
  pinned: boolean;
}

/**
 * Existing destination's content differs from what we were about to
 * write. Returned to the renderer when the overwrite isn't yet
 * confirmed; the renderer prompts the user, then calls again with
 * `forceOverwrite: true`. `existingContent` / `pendingContent` are
 * surfaced so a future UI can show a diff — v1 just shows a
 * "Overwrite [path]?" prompt.
 */
export interface SaveCellOutputNeedsConfirm {
  status: 'needs-confirm';
  derivedPath: string;
  cellId: string;
  existingContent: string;
  pendingContent: string;
}

export type SaveCellOutputResult = SaveCellOutputWritten | SaveCellOutputNeedsConfirm;

export async function saveCellOutput(
  rootPath: string,
  input: SaveCellOutputInput,
): Promise<SaveCellOutputResult> {
  // Re-read the source doc to find the fence. Matching by (language, exact
  // code) is the same heuristic the editor extension uses when applying an
  // output-block edit after an awaited run.
  let sourceContent = await notebaseFs.readFile(rootPath, input.sourcePath);
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
    sourceContent = rewriteFenceInfo(sourceContent, fence.startOffset, newInfo);
    await notebaseFs.writeFile(rootPath, input.sourcePath, sourceContent);
  }

  // Pin resolution (#244). The save is effectively pinned when either
  // (a) the caller passed `pin: true` — explicit Pin to notebook click
  // — or (b) the source cell's fence already carries `pin=true` from a
  // prior Pin save. Either way, if a derived note exists in the graph
  // for this (source, cellId) pair, we save to its path rather than
  // the caller's destPath.
  const fenceInfoAfterId = wasNew ? newInfo : fenceInfo;
  const cellAlreadyPinned = hasPinFlag(fenceInfoAfterId);
  const shouldPin = input.pin === true || cellAlreadyPinned;
  let derivedPath: string;
  if (shouldPin) {
    const existing = findDerivedNoteForCell(projectContext(rootPath), input.sourcePath, cellId);
    derivedPath = existing ?? input.destPath ?? defaultDerivedNotePath(input.sourcePath, cellId);
  } else {
    derivedPath = input.destPath ?? defaultDerivedNotePath(input.sourcePath, cellId);
  }

  const { markdown, assets } = buildDerivedNote({
    title: input.title,
    output: input.output,
    sourcePath: input.sourcePath,
    cellId,
    derivedPath,
  });

  const destFull = path.join(rootPath, derivedPath);

  // Confirm-on-diff (#244). When the destination already exists and
  // its on-disk content differs from what we're about to write, the
  // saver returns a `needs-confirm` result so the renderer can prompt
  // the user before overwriting. Callers re-invoke with
  // `forceOverwrite: true` after the user confirms.
  //
  // `derived_at` is excluded from the comparison: re-running a cell
  // with the same output regenerates the same body but with a fresh
  // timestamp. Prompting on that would be noise. If everything else
  // matches, we keep the existing on-disk content (preserving the
  // original timestamp as a provenance "created at"), and return
  // 'written' without touching the file.
  if (!input.forceOverwrite) {
    const existing = await readIfExists(destFull);
    if (existing !== null) {
      const existingStable = stripDerivedAt(existing);
      const pendingStable = stripDerivedAt(markdown);
      if (existingStable === pendingStable) {
        // No semantic change — skip the write so derived_at sticks
        // to the original generation time, and don't prompt the user.
        return {
          status: 'written',
          derivedPath,
          cellId,
          injectedId: wasNew,
          pinned: cellAlreadyPinned || (shouldPin && input.pin === true),
        };
      }
      return {
        status: 'needs-confirm',
        derivedPath,
        cellId,
        existingContent: existing,
        pendingContent: markdown,
      };
    }
  }

  await fs.mkdir(path.dirname(destFull), { recursive: true });
  await fs.writeFile(destFull, markdown, 'utf-8');

  // Sidecar assets — image / SVG cell outputs land under
  // `.minerva/assets/derived/` (#244 phase 2). Sequential rather than
  // parallel since most saves emit zero or one asset; the parallel
  // form would just add ceremony.
  for (const asset of assets) {
    const assetFull = path.join(rootPath, asset.relativePath);
    await fs.mkdir(path.dirname(assetFull), { recursive: true });
    if (typeof asset.contents === 'string') {
      await fs.writeFile(assetFull, asset.contents, 'utf-8');
    } else {
      await fs.writeFile(assetFull, asset.contents);
    }
  }

  // After a successful write, propagate the pin flag onto the source
  // fence if the caller asked for pinning OR the cell was already
  // pinned. Idempotent: re-pinning an already-pinned cell rewrites the
  // same info string.
  let pinned = cellAlreadyPinned;
  if (shouldPin && !cellAlreadyPinned) {
    const pinnedInfo = setPinFlag(fenceInfoAfterId, true);
    const pinnedSource = rewriteFenceInfo(sourceContent, fence.startOffset, pinnedInfo);
    if (pinnedSource !== sourceContent) {
      await notebaseFs.writeFile(rootPath, input.sourcePath, pinnedSource);
    }
    pinned = true;
  }

  return {
    status: 'written',
    derivedPath,
    cellId,
    injectedId: wasNew,
    pinned,
  };
}

async function readIfExists(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Strip the `derived_at` frontmatter line so the diff comparison
 * isn't tripped by the regenerate-timestamp moving forward each run.
 * Run on both sides of the compare in `saveCellOutput`.
 */
function stripDerivedAt(markdown: string): string {
  return markdown.replace(/^derived_at: .*$/m, 'derived_at: …');
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
