/**
 * The `:::mindmap` block's spec and its drawing (#2966): the body read (a
 * focus link and key: value lines, defaults where absent), each node's label
 * saying what the title can't, and the still SVG an export draws.
 */
import { describe, it, expect } from 'vitest';
import { parseMindmapBlock } from '../../../src/shared/mindmap/note-hierarchy';
import { mindmapDisplayLabel, mindmapDisplayTree } from '../../../src/renderer/lib/components/mindmap/mindmap-display';
import { layoutMindmap } from '../../../src/shared/mindmap/mindmap-layout';
import { mindmapSvg, MINDMAP_EXPORT_COLORS } from '../../../src/shared/mindmap/mindmap-svg';

describe('parseMindmapBlock (#2966)', () => {
  it('reads the focus link and the options, in any order; ignores the rest', () => {
    expect(parseMindmapBlock('relation: parent\n[[Launch plan|the plan]]\ndepth: 9\ndirection: out\nlayout: radial\ncolour: red')).toEqual({
      focus: 'Launch plan', relation: 'parent', direction: 'out', depth: 6, layout: 'radial',
    });
  });
  it('defaults: the focus note\'s headings, inward, three deep, left to right', () => {
    expect(parseMindmapBlock('[[Plan]]')).toEqual({ focus: 'Plan', relation: 'headings', direction: 'in', depth: 3, layout: 'ltr' });
    expect(parseMindmapBlock('').focus).toBe('');
  });
});

describe('what a node says (#2966)', () => {
  it('the relation that joins it, where it appears more than once, a cycle, what lies past the depth — in words', () => {
    expect(mindmapDisplayLabel({ id: 'a', label: 'A reason', path: 'a.md', children: [], via: 'Supports' })).toBe('Supports: A reason');
    expect(mindmapDisplayLabel({ id: 'b', label: 'Shared', path: 'b.md', children: [], mark: 'shared', appearances: 2 })).toBe('Shared (in 2 places)');
    expect(mindmapDisplayLabel({ id: 'c', label: 'Loop', path: 'c.md', children: [], mark: 'cycle', appearances: 2 })).toBe('Loop (loops back)');
    expect(mindmapDisplayLabel({ id: 'd', label: 'Deep', path: 'd.md', children: [], more: 3 })).toBe('Deep (+3 more)');
  });
});

describe('mindmapSvg (#2966)', () => {
  it('a box and wrapped label per node, a curve per link, colours as attributes, a title', () => {
    const tree = mindmapDisplayTree({ id: 'r', label: 'Launch', path: 'l.md', children: [
      { id: 'a', label: 'Build <it>', path: 'b.md', children: [] }, { id: 'b', label: 'Market', path: 'm.md', children: [] },
    ] });
    const svg = mindmapSvg(layoutMindmap(tree, { orientation: 'ltr' }), MINDMAP_EXPORT_COLORS, { title: 'Mindmap of Launch' });
    expect(svg.match(/<rect [^>]*rx="7"/g)).toHaveLength(3);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('>Build &lt;it&gt;</tspan>');
    expect(svg).toContain('<title>Mindmap of Launch</title>');
    expect(svg).toContain(`stroke="${MINDMAP_EXPORT_COLORS.rootBorder}"`);
    expect(svg).not.toMatch(/<style|url\(/);
  });
});
