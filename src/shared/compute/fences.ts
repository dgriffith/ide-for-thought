/**
 * Pure fence-parsing primitives shared by the renderer (CodeMirror compute
 * cells) and the main process (`save-cell-output` derived-note writer).
 *
 * These used to live in `renderer/lib/editor/output-block.ts`, but the main
 * process needs `findRunnableFences` / `codeOf` / `FenceRange` to locate and
 * read executable fences when saving a cell's output as a note (#244). Main
 * must not import renderer code, so the language-agnostic fence scanning lives
 * here in `shared/`. The pure output-block *reading* helpers
 * (`findAdjacentOutputBlock`, `findCellOutput`) likewise live in shared
 * (`cell-output.ts`); only the *editing* helpers (`planOutputEdit`) stay in the
 * renderer's editor module.
 *
 * Operating on raw strings keeps them trivially unit-testable without a
 * CodeMirror view.
 */

/**
 * Fence languages the compute shell can execute — the single source of truth
 * for "which fences get a run affordance", shared by the editor gutter, the
 * preview run buttons, the Recompute-all button's visibility check, and the
 * cell-output scanners. `py` / `python3` are aliases the backend maps to the
 * Python executor.
 *
 * Must stay in sync with the executors registered in
 * `main/compute/executors/index.ts`; `tests/main/compute/registry.test.ts`
 * asserts the two match so this list can't silently drift from what the
 * backend can actually run.
 */
export const RUNNABLE_LANGUAGES = ['sparql', 'sql', 'python', 'py', 'python3'] as const;

/** Lower-cased set form for `findRunnableFences` and membership checks. */
export const RUNNABLE_LANGUAGE_SET: ReadonlySet<string> = new Set(RUNNABLE_LANGUAGES);

export interface FenceRange {
  /** Byte offset where the opening triple-backtick line begins. */
  startOffset: number;
  /** Byte offset of the character just after the closing triple-backtick newline. */
  endOffset: number;
  /** Fence language (case as written in the doc). */
  language: string;
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
    // Accept optional post-language info (e.g. `sparql {id=abc}`), but
    // require *some* language tag — an unlabeled ``` is a plain code
    // block the compute shell leaves alone.
    const open = line.match(/^```(\w+)(\s.*)?$/);
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
