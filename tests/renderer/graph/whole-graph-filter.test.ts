/**
 * The graph tab's filters (#2958): kinds, folder (with subfolders), type, tag,
 * orphans, and depth from a focused note — the neighbourhood graph as a mode.
 */
import { describe, it, expect } from 'vitest';
import { filterWholeGraph, NO_FILTERS } from '../../../src/renderer/lib/graph/whole-graph-filter';
import type { WholeGraphNode } from '../../../src/shared/types';

const note = (id: string, o: Partial<WholeGraphNode> = {}): WholeGraphNode =>
  ({ id, kind: 'note', label: id, exists: true, folder: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '', type: null, tags: [], ...o });
const edge = (source: string, target: string, linkType = 'references') => ({ source, target, linkType, linkLabel: linkType, linkColor: '#fff', direction: 'out' as const });

// a → b → c → d (a chain), e alone; b and c in trip/, c typed place and tagged; s a source cited by a.
const G = {
  nodes: [
    note('a.md'), note('trip/b.md'), note('trip/day/c.md', { type: 'place', tags: ['prague'] }), note('d.md'), note('e.md'),
    { ...note('source:s'), kind: 'source' as const, folder: '' },
  ],
  edges: [edge('a.md', 'trip/b.md'), edge('trip/b.md', 'trip/day/c.md', 'property:location'), edge('trip/day/c.md', 'd.md'), edge('a.md', 'source:s', 'cite')],
};
const ids = (r: { nodes: { id: string }[] }) => r.nodes.map((n) => n.id).sort();

describe('filterWholeGraph (#2958)', () => {
  it('with no filters, everything', () => {
    expect(ids(filterWholeGraph(G, NO_FILTERS))).toEqual(['a.md', 'd.md', 'e.md', 'source:s', 'trip/b.md', 'trip/day/c.md']);
  });

  it('a hidden kind drops its edges (and hiding orphans then drops what they held)', () => {
    const r = filterWholeGraph(G, { ...NO_FILTERS, hiddenKinds: ['property:location'], hideOrphans: true });
    expect(r.edges.some((e) => e.linkType === 'property:location')).toBe(false);
    expect(ids(r)).not.toContain('e.md');
    expect(ids(r)).toContain('trip/day/c.md'); // still held by its edge to d
  });

  it('a folder keeps its notes and its subfolders\'; a source stays while a kept note cites it', () => {
    expect(ids(filterWholeGraph(G, { ...NO_FILTERS, folder: 'trip' }))).toEqual(['trip/b.md', 'trip/day/c.md']);
    expect(ids(filterWholeGraph({ ...G }, { ...NO_FILTERS, folder: '' }))).toContain('a.md');
  });

  it('type and tag keep the notes that match', () => {
    expect(ids(filterWholeGraph(G, { ...NO_FILTERS, type: 'place' }))).toEqual(['trip/day/c.md']);
    expect(ids(filterWholeGraph(G, { ...NO_FILTERS, tag: 'prague' }))).toEqual(['trip/day/c.md']);
  });

  it('depth from a focused note keeps what is within that many steps, either way along an edge', () => {
    expect(ids(filterWholeGraph(G, { ...NO_FILTERS, focus: 'trip/b.md', depth: 1 }))).toEqual(['a.md', 'trip/b.md', 'trip/day/c.md']);
    expect(ids(filterWholeGraph(G, { ...NO_FILTERS, focus: 'trip/b.md', depth: 2 }))).toEqual(['a.md', 'd.md', 'source:s', 'trip/b.md', 'trip/day/c.md']);
    // A focus the filters removed draws the filtered graph rather than nothing.
    expect(ids(filterWholeGraph(G, { ...NO_FILTERS, type: 'place', focus: 'a.md', depth: 1 }))).toEqual(['trip/day/c.md']);
  });
});

describe('restoredGraphState (#2958)', () => {
  it('reads back what a tab kept, and falls back on anything it cannot use', async () => {
    const { restoredGraphState, NEW_GRAPH_STATE } = await import('../../../src/renderer/lib/graph/whole-graph-filter');
    expect(restoredGraphState({
      hiddenKinds: ['tag', 3], folder: 'trip', type: null, tag: 'x', hideOrphans: true, focus: 'a.md', depth: 9, showTags: true,
      camera: { zoom: 0.5, pan: { x: 10, y: -4 } },
    })).toEqual({ hiddenKinds: ['tag'], folder: 'trip', type: null, tag: 'x', hideOrphans: true, focus: 'a.md', depth: 6, showTags: true, camera: { zoom: 0.5, pan: { x: 10, y: -4 } } });
    expect(restoredGraphState('garbage')).toEqual(NEW_GRAPH_STATE);
    expect(restoredGraphState({ depth: 0, camera: { zoom: 'big' } })).toMatchObject({ depth: null, camera: null });
  });
});
