/**
 * Locate every `-hidden` fenced code block's fold range (#2039), mirroring
 * `findFrontmatterFoldRange`'s shape exactly: a pure `LineDoc` scan (no live
 * CodeMirror view needed, so it's unit-testable the same way), returning
 * CodeMirror-style character offsets with `from`/`to` at the end of the
 * opening/closing fence lines — folding the body while keeping both fence
 * lines visible, same convention as the frontmatter fold.
 *
 * Deliberately hand-scanned rather than driven by CodeMirror's own
 * `foldable()`/`foldNodeProp` (which *do* already fold a plain fenced code
 * block via the gutter arrow with zero extra code) — this needs to run
 * against a `LineDoc` before any EditorView/syntax tree exists, and
 * `foldEffect.of(range)` accepts any explicit range regardless of whether it
 * came from the language's own fold computation.
 */
import type { LineDoc, FoldRange } from './frontmatter';
import { parseFenceInfo } from '../../../shared/markdown/fence-info';

const FENCE_OPEN_RE = /^```(\S*)\s*$/;

export function findHiddenFenceFoldRanges(doc: LineDoc): FoldRange[] {
  const ranges: FoldRange[] = [];
  let i = 1;
  while (i <= doc.lines) {
    const line = doc.line(i);
    const match = FENCE_OPEN_RE.exec(line.text.trim());
    if (!match) { i++; continue; }
    const { hidden } = parseFenceInfo(match[1] ?? '');
    let j = i + 1;
    while (j <= doc.lines && doc.line(j).text.trim() !== '```') j++;
    const closed = j <= doc.lines;
    if (hidden && closed) {
      ranges.push({ from: line.to, to: doc.line(j).to });
    }
    // Resume scanning after the closing fence (or at EOF if unclosed) — a
    // fence body is never itself scanned for a nested opening marker.
    i = closed ? j + 1 : doc.lines + 1;
  }
  return ranges;
}
