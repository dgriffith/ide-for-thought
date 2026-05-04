import { describe, it, expect } from 'vitest';
import { buildTagTree, flattenTagTree, subtreeMatches } from '../../src/renderer/lib/tags';

describe('buildTagTree (#466)', () => {
  it('builds a single-level tree from a flat tag', () => {
    const tree = buildTagTree([{ tag: 'projects', count: 3 }]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      segment: 'projects',
      path: 'projects',
      count: 3,
      hasOwnTag: true,
    });
    expect(tree[0].children).toEqual([]);
  });

  it('nests `/`-separated tags into a tree', () => {
    const tree = buildTagTree([
      { tag: 'projects/minerva/ui', count: 2 },
      { tag: 'projects/minerva/api', count: 1 },
    ]);
    expect(tree).toHaveLength(1);
    const projects = tree[0];
    expect(projects.path).toBe('projects');
    expect(projects.hasOwnTag).toBe(false);
    expect(projects.count).toBe(3);

    const minerva = projects.children[0];
    expect(minerva.path).toBe('projects/minerva');
    expect(minerva.hasOwnTag).toBe(false);
    expect(minerva.children.map((c) => c.path).sort()).toEqual([
      'projects/minerva/api',
      'projects/minerva/ui',
    ]);
  });

  it('flags hasOwnTag on a node that exists as a literal tag', () => {
    const tree = buildTagTree([
      { tag: 'projects', count: 1 },
      { tag: 'projects/minerva', count: 2 },
    ]);
    expect(tree[0].hasOwnTag).toBe(true);
    expect(tree[0].count).toBe(3);
    expect(tree[0].children[0].hasOwnTag).toBe(true);
  });

  it('sorts siblings alphabetically', () => {
    const tree = buildTagTree([
      { tag: 'projects/zen', count: 1 },
      { tag: 'projects/api', count: 1 },
      { tag: 'projects/minerva', count: 1 },
    ]);
    expect(tree[0].children.map((c) => c.segment)).toEqual(['api', 'minerva', 'zen']);
  });
});

describe('flattenTagTree (#466)', () => {
  const tree = buildTagTree([
    { tag: 'projects/minerva/ui', count: 1 },
    { tag: 'projects/api', count: 1 },
  ]);

  it('returns parents before children when expanded', () => {
    const rows = flattenTagTree(tree, () => true);
    expect(rows.map((r) => r.path)).toEqual([
      'projects',
      'projects/api',
      'projects/minerva',
      'projects/minerva/ui',
    ]);
  });

  it('hides children of collapsed parents', () => {
    const rows = flattenTagTree(tree, (path) => path !== 'projects/minerva');
    expect(rows.map((r) => r.path)).toEqual([
      'projects',
      'projects/api',
      'projects/minerva',
    ]);
  });
});

describe('subtreeMatches (#466)', () => {
  const [projects] = buildTagTree([
    { tag: 'projects/minerva/ui', count: 1 },
    { tag: 'projects/api', count: 1 },
  ]);

  it('matches a substring of any descendant path', () => {
    expect(subtreeMatches(projects, 'minerva')).toBe(true);
    expect(subtreeMatches(projects, 'min')).toBe(true);
  });

  it('matches the node itself', () => {
    expect(subtreeMatches(projects, 'projects')).toBe(true);
  });

  it('returns false when no descendant matches', () => {
    expect(subtreeMatches(projects, 'unrelated')).toBe(false);
  });
});
