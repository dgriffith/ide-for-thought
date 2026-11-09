/**
 * The mindmap's layout (#2964): left to right and radial, no two boxes
 * overlapping (any tree, any labels — a property), siblings in order,
 * children beyond their parent, long labels wrapped, folds leaving a subtree
 * out with a count, and curved connectors from edge to edge.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { layoutMindmap, wrapLabel, type MindmapLayout, type MindmapTree } from '../../../src/shared/mindmap/mindmap-layout';

const t = (id: string, children: MindmapTree[] = [], label = id): MindmapTree => ({ id, label, children });
const SMALL = t('root', [t('a', [t('a1'), t('a2')]), t('b'), t('c', [t('c1', [t('c1x')])])], 'Root');

const overlaps = (l: MindmapLayout) => {
  const out: string[] = [];
  for (let i = 0; i < l.nodes.length; i++) for (let j = i + 1; j < l.nodes.length; j++) {
    const a = l.nodes[i]!, b = l.nodes[j]!;
    if (Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 0.5 && Math.abs(a.y - b.y) < (a.height + b.height) / 2 - 0.5) out.push(`${a.id}/${b.id}`);
  }
  return out;
};
const byId = (l: MindmapLayout) => new Map(l.nodes.map((n) => [n.id, n] as const));

describe('layoutMindmap, left to right (#2964)', () => {
  const l = layoutMindmap(SMALL, { orientation: 'ltr' });
  const n = byId(l);

  it('puts each depth in its own column, children right of their parent, siblings top to bottom in order', () => {
    expect(n.get('a')!.x).toBeGreaterThan(n.get('root')!.x);
    expect(n.get('a1')!.x).toBeGreaterThan(n.get('a')!.x);
    expect(n.get('a')!.x).toBe(n.get('c')!.x);
    expect(n.get('a')!.y).toBeLessThan(n.get('b')!.y);
    expect(n.get('b')!.y).toBeLessThan(n.get('c')!.y);
    expect(n.get('a1')!.y).toBeLessThan(n.get('a2')!.y);
    expect(overlaps(l)).toEqual([]);
  });

  it('draws a curve from the parent\'s right edge to the child\'s left edge', () => {
    const link = l.links.find((k) => k.target === 'b')!;
    const [sx, sy] = /^M([\d.-]+),([\d.-]+)/.exec(link.path)!.slice(1).map(Number);
    expect(sx).toBeCloseTo(n.get('root')!.x + n.get('root')!.width / 2, 0);
    expect(sy).toBeCloseTo(n.get('root')!.y, 0);
    expect(link.path).toMatch(/C/);
    expect(l.links).toHaveLength(l.nodes.length - 1);
  });
});

describe('layoutMindmap, radial (#2964)', () => {
  it('centres the root; each depth on a ring further out; siblings in order around it', () => {
    const l = layoutMindmap(SMALL, { orientation: 'radial' });
    const n = byId(l);
    const r = (id: string) => Math.hypot(n.get(id)!.x, n.get(id)!.y);
    const angle = (id: string) => (Math.atan2(n.get(id)!.y, n.get(id)!.x) + 2.5 * Math.PI) % (2 * Math.PI);
    expect(Math.hypot(n.get('root')!.x, n.get('root')!.y)).toBe(0);
    expect(r('a')).toBeCloseTo(r('b'), 5);
    expect(r('a1')).toBeGreaterThan(r('a'));
    expect(angle('a')).toBeLessThan(angle('b'));
    expect(angle('b')).toBeLessThan(angle('c'));
    expect(overlaps(l)).toEqual([]);
  });
});

describe('labels and folds (#2964)', () => {
  it('wraps a long label to the maximum width, a word too long for it on its own line', () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapLabel('one two three four', 100, measure)).toEqual(['one two', 'three four']);
    expect(wrapLabel('supercalifragilistic x', 100, measure)).toEqual(['supercalifragilistic', 'x']);
    const l = layoutMindmap(t('r', [], 'a label long enough to wrap onto several lines'), { orientation: 'ltr', maxLabelWidth: 120 });
    expect(l.nodes[0]!.lines.length).toBeGreaterThan(1);
    expect(l.nodes[0]!.height).toBeGreaterThan(30);
  });

  it('a folded node keeps its place, loses its subtree from the drawing, and counts what it hides', () => {
    const l = layoutMindmap(SMALL, { orientation: 'ltr', folded: new Set(['c']) });
    const n = byId(l);
    expect(n.has('c1')).toBe(false);
    expect(n.get('c')).toMatchObject({ folded: true, hasChildren: true, hiddenCount: 2, children: [] });
    expect(n.get('a')).toMatchObject({ folded: false, hiddenCount: 0, children: ['a1', 'a2'] });
    // A leaf "folded" is nothing to fold.
    expect(byId(layoutMindmap(SMALL, { orientation: 'ltr', folded: new Set(['b']) })).get('b')).toMatchObject({ folded: false, hiddenCount: 0 });
  });
});

/** A random tree, four levels at most, up to four children each, labels of any length. */
let ids = 0;
const randomTree = (depth: number): fc.Arbitrary<MindmapTree> =>
  fc.record({
    label: fc.string({ maxLength: 70 }),
    children: depth === 0 ? fc.constant([] as MindmapTree[]) : fc.array(randomTree(depth - 1), { maxLength: 4 }),
  }).map(({ label, children }) => ({ id: `n${ids++}`, label, children }));

describe('no two boxes overlap, any tree, either way (#2964)', () => {
  it('left to right and radial', () => {
    fc.assert(fc.property(randomTree(4), fc.constantFrom('ltr' as const, 'radial' as const), (tree, orientation) => {
      expect(overlaps(layoutMindmap(tree, { orientation }))).toEqual([]);
    }), { numRuns: 200 });
  });
});
