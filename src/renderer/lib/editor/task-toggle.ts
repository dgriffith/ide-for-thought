/**
 * Toggle a task-list checkbox (`[ ]` ↔ `[x]`) on a specific line.
 *
 * `lineIndex` is 0-indexed, matching markdown-it's token `map` convention
 * (which is what the preview emits on rendered checkboxes). Returns the
 * original content unchanged when the line isn't a task-list item —
 * callers can rely on reference-equality to detect "did anything change."
 */
export function toggleTaskOnLine(content: string, lineIndex: number): string {
  const lines = content.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return content;
  const m = lines[lineIndex].match(
    /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s[\s\S]*)?$/,
  );
  if (!m) return content;
  const next = m[2] === ' ' ? 'x' : ' ';
  lines[lineIndex] = `${m[1]}[${next}]${m[3] ?? ''}`;
  return lines.join('\n');
}
