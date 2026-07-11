/**
 * Structure-sidebar tree (#1133). Pins the folder grouping, folders-first
 * ordering, and the ancestor-containment check that drives auto-expansion.
 */
import { describe, it, expect } from 'vitest';
import { buildSidebarTree, subtreeContains } from '../../../src/main/publish/exporters/static-site/sidebar';

describe('buildSidebarTree (#1133)', () => {
  it('groups notes into a nested folder tree, folders before notes, alpha-sorted', () => {
    const tree = buildSidebarTree([
      { relativePath: 'zebra.md', title: 'Zebra' },
      { relativePath: 'notes/beta.md', title: 'Beta' },
      { relativePath: 'notes/alpha.md', title: 'Alpha' },
      { relativePath: 'apple.md', title: 'Apple' },
    ]);
    // Top level: folder "notes" first, then notes Apple, Zebra.
    expect(tree.map((n) => n.name)).toEqual(['notes', 'Apple', 'Zebra']);
    expect(tree[0]!.children!.map((n) => n.name)).toEqual(['Alpha', 'Beta']);
    // Leaves carry the note path; the folder carries none.
    expect(tree[0]!.path).toBeUndefined();
    expect(tree[1]!.path).toBe('apple.md');
  });

  it('nests deep folders', () => {
    const tree = buildSidebarTree([{ relativePath: 'a/b/c/deep.md', title: 'Deep' }]);
    expect(tree[0]!.name).toBe('a');
    expect(tree[0]!.children![0]!.children![0]!.children![0]!.path).toBe('a/b/c/deep.md');
  });
});

describe('subtreeContains', () => {
  it('finds a note anywhere in a folder subtree (drives ancestor auto-expand)', () => {
    const tree = buildSidebarTree([
      { relativePath: 'a/b/target.md', title: 'T' },
      { relativePath: 'x/other.md', title: 'O' },
    ]);
    expect(subtreeContains(tree, 'a/b/target.md')).toBe(true);
    expect(subtreeContains(tree[0]!.children!, 'a/b/target.md')).toBe(true); // inside "a"
    expect(subtreeContains(tree.filter((n) => n.name === 'x'), 'a/b/target.md')).toBe(false);
  });
});
