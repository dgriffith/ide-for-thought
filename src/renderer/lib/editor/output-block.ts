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
 */

export type CellResultLike =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

export interface FenceRange {
  /** Byte offset where the opening triple-backtick line begins. */
  startOffset: number;
  /** Byte offset of the character just after the closing triple-backtick newline. */
  endOffset: number;
  /** Fence language (case as written in the doc). */
  language: string;
}

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

/**
 * Walk the doc for executable fences whose language is in `allowed`.
 * Line positions are 1-based (matches CodeMirror's line numbering) to
 * keep the consumer boring. Pure so the CM-less tests can exercise it.
 */
export function findRunnableFences(
  doc: string,
  allowed: ReadonlySet<string>,
): Array<FenceRange & { openingLine: number; closingLine: number }> {
  const out: Array<FenceRange & { openingLine: number; closingLine: number }> = [];
  const lines = doc.split('\n');
  // Running byte offsets per line start.
  const lineOffsets: number[] = [0];
  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(lineOffsets[i] + lines[i].length + 1);
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const open = line.match(/^```(\w+)\s*$/);
    if (!open) { i++; continue; }
    const language = open[1];
    // Find the closing fence.
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === '```') { close = j; break; }
    }
    if (close < 0) break; // unclosed fence; stop scanning
    if (allowed.has(language.toLowerCase())) {
      const startOffset = lineOffsets[i];
      // endOffset: position just after the closing ```. When the closing
      // line is followed by more content (`close < lines.length - 1`),
      // a `\n` sits between the closing ``` and the next line, so we
      // skip past it. When the fence is the last thing in the doc —
      // no trailing newline — endOffset stops at doc.length. Without
      // this the offset ran one past the end, which made subsequent
      // `view.dispatch({ changes: { from: endOffset } })` calls silently
      // no-op in CodeMirror, breaking output-block writes for any note
      // that ended with an executable fence.
      const hasTrailingNewline = close < lines.length - 1;
      const endOffset = lineOffsets[close] + lines[close].length + (hasTrailingNewline ? 1 : 0);
      out.push({
        startOffset,
        endOffset,
        language,
        openingLine: i + 1,
        closingLine: close + 1,
      });
    }
    i = close + 1;
  }
  return out;
}

/**
 * Extract the inner code of a fence range from the doc (everything
 * between the opening and closing fence lines, with no trailing newline).
 */
export function codeOf(doc: string, fence: FenceRange): string {
  const body = doc.slice(fence.startOffset, fence.endOffset);
  const nl = body.indexOf('\n');
  if (nl < 0) return '';
  // Drop the opening ```lang line.
  const withoutOpen = body.slice(nl + 1);
  // Drop the closing ``` (with or without trailing newline).
  const withoutClose = withoutOpen.replace(/```(\n|$)[\s\S]*$/, '');
  return withoutClose.replace(/\n$/, '');
}
