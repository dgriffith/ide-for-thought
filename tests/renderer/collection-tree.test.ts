/**
 * Pure collection-tree algorithms extracted from SourcesPanel (#672).
 */
import { describe, it, expect } from 'vitest';
import {
  collectionSubtree,
  membersInSubtree,
  subtreeCounts,
  flattenCollectionRows,
  filterSources,
} from '../../src/renderer/lib/sources/collection-tree';
import type { Collection, SourceMetadata } from '../../src/shared/types';

function coll(id: string, parent: string | null, members: string[] = [], name = id): Collection {
  return { id, name, parent, members };
}
function src(sourceId: string, over: Partial<SourceMetadata> = {}): SourceMetadata {
  return { sourceId, creators: [], year: '', ...over } as SourceMetadata;
}

// a ─ b ─ d
//   └ c
const TREE = [coll('a', null, ['s1']), coll('b', 'a', ['s2']), coll('c', 'a', ['s3']), coll('d', 'b', ['s4'])];

describe('collectionSubtree', () => {
  it('returns the focused collection + all descendants', () => {
    expect(collectionSubtree('a', false, TREE)).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(collectionSubtree('b', false, TREE)).toEqual(new Set(['b', 'd']));
    expect(collectionSubtree('d', false, TREE)).toEqual(new Set(['d']));
  });
  it('returns null when nothing is focused or the focus is smart', () => {
    expect(collectionSubtree(null, false, TREE)).toBeNull();
    expect(collectionSubtree('a', true, TREE)).toBeNull();
  });
});

describe('membersInSubtree', () => {
  it('unions members across the subtree', () => {
    const sub = collectionSubtree('a', false, TREE)!;
    expect(membersInSubtree(sub, TREE)).toEqual(new Set(['s1', 's2', 's3', 's4']));
    expect(membersInSubtree(new Set(['b', 'd']), TREE)).toEqual(new Set(['s2', 's4']));
  });
});

describe('subtreeCounts', () => {
  it('counts subtree-rooted membership (includes descendants), deduped', () => {
    const counts = subtreeCounts(TREE);
    expect(counts.get('a')).toBe(4); // s1..s4
    expect(counts.get('b')).toBe(2); // s2, s4
    expect(counts.get('c')).toBe(1); // s3
    expect(counts.get('d')).toBe(1); // s4
  });
  it('dedupes a source filed in both a parent and child', () => {
    const counts = subtreeCounts([coll('p', null, ['x']), coll('ch', 'p', ['x'])]);
    expect(counts.get('p')).toBe(1);
  });
});

describe('flattenCollectionRows', () => {
  it('flattens in display order, hiding descendants of collapsed nodes', () => {
    const collapsed = flattenCollectionRows(TREE, {}).map((r) => r.collection.id);
    expect(collapsed).toEqual(['a']); // b/c hidden until a expanded
    const expanded = flattenCollectionRows(TREE, { a: true, b: true }).map((r) => r.collection.id);
    expect(expanded).toEqual(['a', 'b', 'd', 'c']); // siblings name-sorted; d under b
  });
  it('marks hasChildren + depth', () => {
    const rows = flattenCollectionRows(TREE, { a: true });
    expect(rows.find((r) => r.collection.id === 'a')).toMatchObject({ depth: 0, hasChildren: true });
    expect(rows.find((r) => r.collection.id === 'c')).toMatchObject({ depth: 1, hasChildren: false });
  });
});

describe('filterSources', () => {
  const sources = [
    src('s1', { creators: ['Ada Lovelace'], year: '1843' }),
    src('s2', { creators: ['Alan Turing'], year: '1936' }),
  ];
  it('filters by active membership', () => {
    expect(filterSources(sources, new Set(['s2']), '').map((s) => s.sourceId)).toEqual(['s2']);
    expect(filterSources(sources, null, '')).toHaveLength(2);
  });
  it('matches the query against byline / year / id', () => {
    expect(filterSources(sources, null, 'turing').map((s) => s.sourceId)).toEqual(['s2']);
    expect(filterSources(sources, null, '1843').map((s) => s.sourceId)).toEqual(['s1']);
    expect(filterSources(sources, null, 's2').map((s) => s.sourceId)).toEqual(['s2']);
  });
});
