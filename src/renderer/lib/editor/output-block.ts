/**
 * Pure helpers for inserting / replacing the companion ```output``` block
 * that follows an executable fence (#238).
 *
 * A cell's result lives IN the note, directly below the fence it came
 * from, as:
 *
 *     ```sparql
 *     SELECT … WHERE { … }
 *     ```
 *
 *     ```output
 *     {"type":"table","columns":["note"],"rows":[["notes/foo"]]}
 *     ```
 *
 * Running the cell either inserts a fresh output block (no neighbour below
 * yet) or replaces the existing one in place. These helpers operate on
 * raw strings so they're trivial to unit-test without spinning up a
 * CodeMirror view.
 *
 * The language-agnostic fence *scanning* primitives (`findRunnableFences`,
 * `codeOf`, `FenceRange`) live in `shared/compute/fences` so the main process
 * can reuse them without importing renderer code (#668); the editing helpers
 * below are renderer-only.
 */

import type { FenceRange } from '../../../shared/compute/fences';
// The pure adjacent-output scan now lives in shared so the chart cell-binding
// finder (#884) and the export pipeline (#885) reuse it. Re-exported here so the
// editing helpers below — and existing importers / tests — keep their entry point.
import { findAdjacentOutputBlock } from '../../../shared/compute/cell-output';
export { findAdjacentOutputBlock };

export type CellResultLike =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

export interface OutputEdit {
  /** Absolute range in the doc to replace. */
  from: number;
  to: number;
  /** Text to insert in place of that range. */
  insert: string;
}

/**
 * Given a fence and a cell result, produce the edit that writes the
 * output block. If an `output` fence already sits immediately below,
 * replaces it; otherwise inserts one on the next line.
 */
export function planOutputEdit(
  doc: string,
  fence: FenceRange,
  result: CellResultLike,
): OutputEdit {
  const payload = resultToJson(result);
  const body = `\`\`\`output\n${payload}\n\`\`\`\n`;

  const existing = findAdjacentOutputBlock(doc, fence.endOffset);
  if (existing) {
    return { from: existing.from, to: existing.to, insert: body };
  }
  // Insert on its own line directly below the fence. The blank line
  // separator keeps markdown renderers happy without being visually
  // noisy in source.
  return {
    from: fence.endOffset,
    to: fence.endOffset,
    insert: `\n${body}`,
  };
}

/**
 * Serialize a result payload to a single JSON line. Error results get
 * the `type: "error"` shape the preview renderer knows how to style.
 */
export function resultToJson(result: CellResultLike): string {
  if (result.ok) {
    return JSON.stringify(result.output);
  }
  return JSON.stringify({ type: 'error', message: result.error });
}
