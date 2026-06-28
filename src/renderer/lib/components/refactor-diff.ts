/**
 * Pure derivations for the refactor review card (#913), extracted so they're
 * unit-testable without rendering Svelte.
 */

/** "Rename" when only the basename changes, "Move" when the folder changes. */
export function refactorVerb(fromPath: string, toPath: string): 'Rename' | 'Move' {
  const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  return dir(fromPath) === dir(toPath) ? 'Rename' : 'Move';
}

export interface ChangedLine {
  before: string;
  after: string;
}

/**
 * The lines that differ between `before` and `after`. Link rewrites are in-place
 * text substitutions, so line structure is preserved — a simple index-wise
 * comparison surfaces exactly the changed (link) lines for the card's diff.
 */
export function changedLines(before: string, after: string): ChangedLine[] {
  const b = before.split('\n');
  const a = after.split('\n');
  const out: ChangedLine[] = [];
  for (let i = 0; i < Math.max(b.length, a.length); i++) {
    if (b[i] !== a[i]) out.push({ before: b[i] ?? '', after: a[i] ?? '' });
  }
  return out;
}
