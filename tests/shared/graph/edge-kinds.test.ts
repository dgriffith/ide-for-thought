/**
 * The graph's one edge model (#2957): the registry every graph surface reads,
 * and the kind an edge between notes is, from the predicate that made it.
 */
import { describe, it, expect } from 'vitest';
import { LINK_TYPES } from '../../../src/shared/link-types';
import { edgeKindForPredicate, edgeKinds, TAG_EDGE_KIND } from '../../../src/shared/graph/edge-kinds';

const THOUGHT = 'https://minerva.dev/ontology/thought#';
const TYPES = 'https://minerva.dev/ontology/types#';

describe('the edge-kind registry (#2957)', () => {
  it('is the LINK_TYPES kinds, the argument relations, one per link property in the catalog, and tags', () => {
    const kinds = edgeKinds([{ name: 'author', label: 'Author' }, { name: 'venue' }, { name: 'author', label: 'Writer' }]);
    const ids = kinds.map((k) => k.id);
    expect(ids.slice(0, LINK_TYPES.length)).toEqual(LINK_TYPES.map((lt) => lt.name));
    expect(ids).toContain('argument:challenges');
    expect(kinds.filter((k) => k.group === 'property').map((k) => [k.id, k.label])).toEqual([['property:author', 'Author'], ['property:venue', 'Venue']]);
    expect(ids.at(-1)).toBe('tag');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every kind shows by default except tags', () => {
    expect(edgeKinds([]).filter((k) => !k.defaultOn)).toEqual([TAG_EDGE_KIND]);
  });

  it('citations are source kinds; body links are link kinds', () => {
    const kinds = edgeKinds([]);
    expect(kinds.find((k) => k.id === 'cite')?.group).toBe('source');
    expect(kinds.find((k) => k.id === 'references')?.group).toBe('link');
  });
});

describe('edgeKindForPredicate (#2957)', () => {
  it('thought:supports and thought:rebuts are the wiki-link Supports and Rebuts kinds: one relation, two forms', () => {
    expect(edgeKindForPredicate(`${THOUGHT}supports`)).toMatchObject({ id: 'supports', label: 'Supports' });
    expect(edgeKindForPredicate(`${THOUGHT}rebuts`)).toMatchObject({ id: 'rebuts' });
  });

  it('the other argument relations are their own kinds', () => {
    expect(edgeKindForPredicate(`${THOUGHT}qualifies`)).toMatchObject({ id: 'argument:qualifies', label: 'Qualifies', group: 'argument' });
  });

  it('a link-to-type property is labelled as the catalog labels it', () => {
    expect(edgeKindForPredicate(`${TYPES}author`, (n) => (n === 'author' ? 'Written by' : undefined))).toMatchObject({ id: 'property:author', label: 'Written by', group: 'property' });
    expect(edgeKindForPredicate(`${TYPES}servedBy`)).toMatchObject({ label: 'Served By' });
  });

  it('any other predicate linking two notes is a frontmatter kind, named for its key', () => {
    expect(edgeKindForPredicate('https://minerva.dev/ontology#meta-related')).toMatchObject({ id: 'frontmatter:meta-related', label: 'Related', group: 'frontmatter' });
    expect(edgeKindForPredicate(`${THOUGHT}seeAlso`)).toMatchObject({ id: 'frontmatter:seeAlso', label: 'See Also' });
  });
});
