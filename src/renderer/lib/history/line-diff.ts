/**
 * Line-level diff for the History panel (#1158). The existing `changedLines`
 * (refactor-diff) is an index-wise compare — fine for in-place link rewrites,
 * but it mis-renders arbitrary edits (an inserted line makes everything after
 * it look "changed"). History revisions are arbitrary edits, so this does a
 * proper LCS line diff. O(m·n) — trivial for note-sized text, no dependency.
 */

export type DiffLineType = 'context' | 'add' | 'remove';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

function splitLines(s: string): string[] {
  // An empty string is zero lines (not one empty line), so an empty note vs a
  // one-line note reads as a single add, not a context + add.
  return s.length === 0 ? [] : s.split('\n');
}

/** Unified line diff of `before` → `after`: shared lines as `context`, removed
 *  lines as `remove`, added lines as `add`, in reading order. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const m = a.length;
  const n = b.length;

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i]! });
      i++; j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ type: 'remove', text: a[i]! });
      i++;
    } else {
      out.push({ type: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < m) { out.push({ type: 'remove', text: a[i]! }); i++; }
  while (j < n) { out.push({ type: 'add', text: b[j]! }); j++; }
  return out;
}

/** Added / removed line counts for a diff (context lines don't count). */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === 'add') added++;
    else if (l.type === 'remove') removed++;
  }
  return { added, removed };
}
