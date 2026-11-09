/**
 * The Graph layout's model (#2960): a type with two link properties gives a
 * node per note and an edge kind per property; `edges` picks which are drawn;
 * `outside` shows a linked note the view doesn't, muted, or leaves it out.
 */
import { describe, it, expect } from 'vitest';
import { graphViewModel, parseGraphEdges, parseGraphOutside, type GraphViewInstance } from '../../../src/shared/objects/graph-view';

const PROPS = [
  { name: 'status', type: 'enum' },
  { name: 'blocks', type: 'link-to-type', label: 'Blocks' },
  { name: 'parent', type: 'link-to-type' },
];
const link = (property: string, path: string) => ({ property, path, title: path.replace(/\.md$/, '') });
const INSTANCES: GraphViewInstance[] = [
  { path: 'a.md', title: 'A', icon: { label: 'Task', color: '#f00' }, links: [link('blocks', 'b.md'), link('parent', 'p.md')] },
  { path: 'b.md', title: 'B', icon: { label: 'Task' }, links: [link('blocks', 'c.md'), link('blocks', 'c.md'), link('blocks', 'b.md')] },
  { path: 'c.md', title: 'C' },
];

describe('graphViewModel (#2960)', () => {
  it('a node per note, in the view order, coloured by its type; an edge kind per link property', () => {
    const m = graphViewModel(INSTANCES, PROPS, { edges: null, outside: 'show' });
    expect(m.nodes.map((n) => [n.id, n.color, n.typeLabel, n.outside])).toEqual([
      ['a.md', '#f00', 'Task', false], ['b.md', null, 'Task', false], ['c.md', null, null, false], ['p.md', null, null, true],
    ]);
    expect(m.edges).toEqual([
      { source: 'a.md', target: 'b.md', property: 'blocks', outside: false },
      { source: 'a.md', target: 'p.md', property: 'parent', outside: true },
      { source: 'b.md', target: 'c.md', property: 'blocks', outside: false },
    ]);
    expect(m.kinds).toEqual([
      { property: 'blocks', label: 'Blocks', on: true, count: 2 },
      { property: 'parent', label: 'parent', on: true, count: 1 },
    ]);
  });

  it('edges draws only the kinds it names, and still counts the rest', () => {
    const m = graphViewModel(INSTANCES, PROPS, { edges: ['parent'], outside: 'show' });
    expect(m.edges.map((e) => e.property)).toEqual(['parent']);
    expect(m.kinds.map((k) => [k.property, k.on, k.count])).toEqual([['blocks', false, 2], ['parent', true, 1]]);
  });

  it('outside: hide leaves a note the view does not show out, and its edge', () => {
    const m = graphViewModel(INSTANCES, PROPS, { edges: null, outside: 'hide' });
    expect(m.nodes.map((n) => n.id)).toEqual(['a.md', 'b.md', 'c.md']);
    expect(m.edges.every((e) => !e.outside)).toBe(true);
  });

  it('an outside note is drawn once, however many link to it', () => {
    const m = graphViewModel([...INSTANCES, { path: 'd.md', title: 'D', links: [link('parent', 'p.md')] }], PROPS, { edges: null, outside: 'show' });
    expect(m.nodes.filter((n) => n.id === 'p.md')).toHaveLength(1);
  });
});

describe('the spec fields (#2960)', () => {
  it('reads edges as a list of names or null, and outside as show unless hide', () => {
    expect(parseGraphEdges(['a', 'a', '', 3, 'b'])).toEqual(['a', 'b']);
    expect(parseGraphEdges('a')).toBeNull();
    expect(parseGraphEdges([])).toEqual([]);
    expect(parseGraphOutside('hide')).toBe('hide');
    expect(parseGraphOutside('nope')).toBe('show');
  });
});
