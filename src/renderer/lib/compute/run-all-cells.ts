/**
 * Content-string batch runner for "Recompute all" from the preview
 * (#238 follow-up). The editor's Run-all drives a live CodeMirror view
 * (see `computeCellsExtension`), but the preview has no editor mounted in
 * preview-only mode — it applies output edits by handing a new full
 * content string back to the host. This helper is that string-threading
 * loop, extracted so it's unit-testable without mounting the Preview
 * component.
 *
 * Semantics match the editor side: fences run **strictly top-to-bottom**
 * (a cell can depend on a prior cell's kernel state) and the batch
 * **halts on the first error**.
 */

import { planOutputEdit } from '../editor/output-block';
import { findRunnableFences, codeOf } from '../../../shared/compute/fences';
import type { CellResult } from '../ipc/client';

export interface RunAllCellsDeps {
  /** Execute one cell. Rejections are caught and written as an error output. */
  runCell: (language: string, code: string) => Promise<CellResult>;
  /** Receive the full content after each cell's output block is spliced in. */
  apply: (content: string) => void;
  /** Toggle a per-cell running indicator, keyed by 1-based opening line. */
  setRunning?: (openingLine: number, running: boolean) => void;
}

/**
 * Re-run every runnable fence in `content`, returning the final content.
 *
 * We re-scan `content` (threaded forward as `working`) each iteration and
 * take the i-th fence: writing an output block shifts every offset below
 * it, but `output` fences aren't runnable, so the fence *count* is stable
 * and index-based iteration is safe even when two fences share code.
 */
export async function runAllCellsInContent(
  content: string,
  langs: ReadonlySet<string>,
  deps: RunAllCellsDeps,
): Promise<string> {
  let working = content;
  const count = findRunnableFences(working, langs).length;
  for (let i = 0; i < count; i++) {
    const fence = findRunnableFences(working, langs)[i];
    if (!fence) break; // content changed under us; stop cleanly
    const code = codeOf(working, fence);
    deps.setRunning?.(fence.openingLine, true);
    let result: CellResult;
    try {
      result = await deps.runCell(fence.language, code);
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      deps.setRunning?.(fence.openingLine, false);
    }
    const edit = planOutputEdit(working, fence, result);
    working = working.slice(0, edit.from) + edit.insert + working.slice(edit.to);
    deps.apply(working); // apply per cell so output lands as it completes
    if (!result.ok) break; // halt; the error output is already applied
  }
  return working;
}
