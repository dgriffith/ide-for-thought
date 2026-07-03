/**
 * Find a compute cell's stored output by id (#832 pt 5 / #884).
 *
 * A runnable cell carries a stable id in its fence info (`sparql {id=a1b2c3d4}`,
 * `cell-id.ts`) and stores its result in a companion ```output block directly
 * below it (`output-block.ts`). To bind a chart to a cell's output we locate the
 * cell by id and read the adjacent block's JSON. Shared so both the renderer
 * (#884) and the export pipeline (#885) resolve cells the same way.
 *
 * The pure adjacent-output scan (`findAdjacentOutputBlock`) lives here too — the
 * renderer's `editor/output-block.ts` re-exports it so its editing helpers and
 * this finder share one implementation.
 */

import { parseFenceInfo } from './cell-id';
import { RUNNABLE_LANGUAGE_SET } from './fences';
import type { CellOutput } from './types';

/** What's stored in an ```output block: a CellOutput, or the `{type:'error'}`
 *  shape a failed cell serializes (`resultToJson`). */
export type StoredCellOutput = CellOutput | { type: 'error'; message: string };

/**
 * Scan forward from `after` for an `output` fence belonging to the cell that
 * just closed. "Adjacent" = only whitespace (at most one blank line) between the
 * cell's close and the opening backticks; anything else means the user wrote
 * prose between them, so it isn't this cell's output. Returns the block's range.
 */
export function findAdjacentOutputBlock(
  doc: string,
  after: number,
): { from: number; to: number } | null {
  let i = after;
  let blankLines = 0;
  while (i < doc.length && (doc[i] === ' ' || doc[i] === '\t' || doc[i] === '\n')) {
    if (doc[i] === '\n') {
      blankLines++;
      if (blankLines > 2) return null; // more than one blank line → not adjacent
    }
    i++;
  }
  if (!doc.startsWith('```output', i)) return null;
  const from = i;
  const openEnd = doc.indexOf('\n', i + '```output'.length);
  if (openEnd < 0) return null;
  const closeLine = findClosingFence(doc, openEnd + 1);
  if (closeLine < 0) return null;
  const to = closeLine + 3 + (doc[closeLine + 3] === '\n' ? 1 : 0);
  return { from, to };
}

function findClosingFence(doc: string, searchStart: number): number {
  let i = searchStart;
  while (i < doc.length) {
    if (doc.startsWith('```', i)) {
      const after = i + 3;
      if (after >= doc.length || doc[after] === '\n' || doc[after] === '\r') return i;
    }
    const nl = doc.indexOf('\n', i);
    if (nl < 0) return -1;
    i = nl + 1;
  }
  return -1;
}

/**
 * Find the stored `CellOutput` for the cell whose fence info carries
 * `{id=cellId}`. Returns null when no such cell exists or it has no adjacent
 * output block (never run). A non-table / error output is returned as-is so the
 * caller can surface a precise message.
 */
export function findCellOutput(content: string, cellId: string): StoredCellOutput | null {
  const lines = content.split('\n');
  let offset = 0;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1; // +1 for the '\n' split removed
    const m = /^```(\S.*)$/.exec(line);
    if (!m) continue;
    const info = m[1];
    const parsed = parseFenceInfo(info);
    if (!RUNNABLE_LANGUAGE_SET.has(parsed.language) || parsed.attrs.id !== cellId) continue;

    // Found the cell's opening fence. Find its closing ``` then the output block.
    const closeLine = findClosingFence(content, lineStart + line.length + 1);
    if (closeLine < 0) return null;
    const cellEnd = closeLine + 3 + (content[closeLine + 3] === '\n' ? 1 : 0);
    const block = findAdjacentOutputBlock(content, cellEnd);
    if (!block) return null;
    return parseOutputJson(content.slice(block.from, block.to));
  }
  return null;
}

/** Extract and parse the JSON payload from an ```output fenced block. */
function parseOutputJson(block: string): StoredCellOutput | null {
  const firstNl = block.indexOf('\n');
  const lastFence = block.lastIndexOf('```');
  if (firstNl < 0 || lastFence <= firstNl) return null;
  const json = block.slice(firstNl + 1, lastFence).trim();
  try {
    return JSON.parse(json) as StoredCellOutput;
  } catch {
    return null;
  }
}
