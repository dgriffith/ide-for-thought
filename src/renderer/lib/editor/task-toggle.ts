/**
 * Toggle a task-list checkbox (`[ ]` ↔ `[x]`) on a specific line, cascading the
 * new state down to every task nested under it.
 *
 * `lineIndex` is 0-indexed, matching markdown-it's token `map` convention
 * (which is what the preview emits on rendered checkboxes). Returns the
 * original content unchanged when the line isn't a task-list item —
 * callers can rely on reference-equality to detect "did anything change."
 *
 * **Downward cascade:** checking (or unchecking) a parent applies the same
 * state to all of its nested sub-tasks — a descendant is any following line
 * indented deeper than the toggled line, up to the first line that dedents back
 * to its level or shallower. Blank lines don't end the subtree; a shallower
 * content line does. Non-task lines inside the subtree (wrapped prose, nested
 * code) are left untouched. Cascade is symmetric: unchecking a parent unchecks
 * its sub-tasks too. (Upward cascade — auto-checking a parent when all its
 * children are checked — is deliberately not implemented yet.)
 */

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s[\s\S]*)?$/;

/** Leading-whitespace width in columns, with tabs advancing to the next
 *  multiple of 4 so tab- and space-indented nesting compare consistently. */
function leadingIndentWidth(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === ' ') w += 1;
    else if (ch === '\t') w += 4 - (w % 4);
    else break;
  }
  return w;
}

/** Rewrite a matched task line's checkbox to `state` (`' '` or `'x'`),
 *  preserving its marker prefix and trailing text. */
function setCheckbox(match: RegExpMatchArray, state: ' ' | 'x'): string {
  return `${match[1]}[${state}]${match[3] ?? ''}`;
}

export function toggleTaskOnLine(content: string, lineIndex: number): string {
  const lines = content.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return content;
  const m = lines[lineIndex]!.match(TASK_RE);
  if (!m) return content;
  const next: ' ' | 'x' = m[2] === ' ' ? 'x' : ' ';
  lines[lineIndex] = setCheckbox(m, next);

  // Cascade `next` down to every task in this line's subtree.
  const parentIndent = leadingIndentWidth(lines[lineIndex]);
  for (let i = lineIndex + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue; // blank lines don't end the subtree
    if (leadingIndentWidth(line) <= parentIndent) break; // dedented out of it
    const cm = line.match(TASK_RE);
    if (cm) lines[i] = setCheckbox(cm, next);
  }
  return lines.join('\n');
}
