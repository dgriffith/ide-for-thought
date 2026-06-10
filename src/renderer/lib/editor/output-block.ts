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
 * Scan forward from `after` for an `output` fence that belongs to the
 * previous executable fence. "Adjacent" means: only whitespace (including
 * at most one blank line) between the previous fence's close and this
 * one's opening backticks. Anything else means the user wrote prose
 * between the two — treat the output as new, don't blow away content.
 */
export function findAdjacentOutputBlock(
  doc: string,
  after: number,
): { from: number; to: number } | null {
  let i = after;
  // Skip a single trailing newline + an optional blank line.
  let blankLines = 0;
  while (i < doc.length && (doc[i] === ' ' || doc[i] === '\t' || doc[i] === '\n')) {
    if (doc[i] === '\n') {
      blankLines++;
      if (blankLines > 2) return null; // more than one blank line → not adjacent
    }
    i++;
  }
  // Must find the opening ``` here.
  if (!doc.startsWith('```output', i)) return null;
  const from = i;
  // Opening line must end with a newline (possibly after whitespace).
  const openEnd = doc.indexOf('\n', i + '```output'.length);
  if (openEnd < 0) return null;
  // Find the closing ``` line.
  const closeLine = findClosingFence(doc, openEnd + 1);
  if (closeLine < 0) return null;
  // Include the trailing newline in the range so the replacement lines
  // up cleanly with the insert path.
  const to = closeLine + 3 + (doc[closeLine + 3] === '\n' ? 1 : 0);
  return { from, to };
}

function findClosingFence(doc: string, searchStart: number): number {
  let i = searchStart;
  while (i < doc.length) {
    // Closing ``` must start at column 0 of its own line.
    if (doc.startsWith('```', i)) {
      // Fence closes only when the ``` is followed by newline or EOF
      // (otherwise it's the opening of a nested fence, which doesn't
      // happen inside `output` blocks we emit, but be tolerant).
      const after = i + 3;
      if (after >= doc.length || doc[after] === '\n' || doc[after] === '\r') {
        return i;
      }
    }
    const nl = doc.indexOf('\n', i);
    if (nl < 0) return -1;
    i = nl + 1;
  }
  return -1;
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
