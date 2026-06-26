/**
 * Heading-tree element building (#845) — nesting reconstruction from the flat
 * `extractHeadings` level list, the substrate of View A.
 */

import { describe, it, expect } from 'vitest';
import { buildHeadingElements } from '../../../src/renderer/lib/graph/heading-graph';
import type { Heading } from '../../../src/renderer/lib/markdown/headings';

const h = (level: number, text: string, line: number): Heading => ({ level, text, line });

describe('buildHeadingElements', () => {
  it('renders just the root for a note with no headings', () => {
    const { nodes, edges } = buildHeadingElements([], 'My Note');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data).toMatchObject({ id: 'root', label: 'My Note', root: true, line: 1 });
    expect(edges).toEqual([]);
  });

  it('falls back to a default root label when blank', () => {
    expect(buildHeadingElements([], '   ').nodes[0].data.label).toBe('Note');
  });

  it('nests headings under their nearest lower-level ancestor', () => {
    const headings = [
      h(1, 'A', 1),   // h0 → root
      h(2, 'A.1', 2), // h1 → h0
      h(3, 'A.1.a', 3), // h2 → h1
      h(2, 'A.2', 4), // h3 → h0
      h(1, 'B', 5),   // h4 → root
    ];
    const { nodes, edges } = buildHeadingElements(headings, 'Doc');
    expect(nodes).toHaveLength(6); // root + 5
    const parentOf = (target: string) => edges.find((e) => e.data.target === target)!.data.source;
    expect(parentOf('h0')).toBe('root');
    expect(parentOf('h1')).toBe('h0');
    expect(parentOf('h2')).toBe('h1');
    expect(parentOf('h3')).toBe('h0'); // back up to A, not A.1.a
    expect(parentOf('h4')).toBe('root');
  });

  it('handles a level jump (h1 → h3) by attaching to the nearest lower level', () => {
    const { edges } = buildHeadingElements([h(1, 'A', 1), h(3, 'deep', 2)], 'Doc');
    expect(edges.find((e) => e.data.target === 'h1')!.data.source).toBe('h0');
  });

  it('attaches a leading high-level heading directly to the root', () => {
    const { edges } = buildHeadingElements([h(3, 'orphan', 1)], 'Doc');
    expect(edges[0].data.source).toBe('root');
  });

  it('carries each heading\'s line for navigation', () => {
    const { nodes } = buildHeadingElements([h(2, 'Intro', 7)], 'Doc');
    expect(nodes.find((n) => n.data.id === 'h0')!.data.line).toBe(7);
  });
});
