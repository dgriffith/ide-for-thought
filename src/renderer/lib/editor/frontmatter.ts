/**
 * Locate the YAML frontmatter block's fold range in a markdown document
 * (#672, extracted from Editor.svelte — the identical scan previously lived
 * in BOTH `findFrontmatterRange()` and the `foldService`, which could drift).
 *
 * Returns CodeMirror-style character offsets: `from` at the end of the
 * opening `---` line, `to` at the end of the closing `---` line, so the fold
 * collapses the YAML body while keeping both fence lines visible in the
 * gutter. Returns null when the doc doesn't open with a `---` fence or has no
 * closing fence.
 *
 * It takes a minimal "line doc" view — line count + a 1-indexed line accessor
 * exposing `text`/`from`/`to` — which CM's `EditorState.doc` satisfies
 * structurally, so callers pass `view.state.doc` directly. `docFromText`
 * builds the same shape from a plain string for non-CM callers and tests.
 */

export interface FoldRange {
  from: number;
  to: number;
}

export interface DocLine {
  text: string;
  from: number;
  to: number;
}

export interface LineDoc {
  /** Total number of lines (1-indexed line space, like CM). */
  lines: number;
  /** 1-indexed line accessor. */
  line(n: number): DocLine;
}

export function findFrontmatterFoldRange(doc: LineDoc): FoldRange | null {
  if (doc.lines < 2) return null;
  const first = doc.line(1);
  if (first.text.trim() !== '---') return null;
  for (let i = 2; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text.trim() === '---') {
      // Span the content between the --- markers, keeping both fences
      // visible as "---" lines in the gutter-collapsed view.
      return { from: first.to, to: line.to };
    }
  }
  return null;
}

/**
 * Build a {@link LineDoc} from a raw string, matching CodeMirror's offset
 * semantics: `from` is the line's start offset, `to` is the position at the
 * end of the line's text (before the trailing newline).
 */
export function docFromText(text: string): LineDoc {
  const parts = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const part of parts) {
    starts.push(offset);
    offset += part.length + 1; // +1 for the '\n' separator
  }
  return {
    lines: parts.length,
    line(n: number): DocLine {
      const i = n - 1;
      const from = starts[i]!;
      const text = parts[i]!;
      return { text, from, to: from + text.length };
    },
  };
}
