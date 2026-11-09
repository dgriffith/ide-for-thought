/**
 * A mindmap as Mermaid `mindmap` text (#2967): the root as a circle, every
 * node by depth, labels quoted so brackets and colons stay text.
 */
import { describe, it, expect } from 'vitest';
import { mindmapMermaid } from '../../../src/shared/mindmap/mindmap-mermaid';

describe('mindmapMermaid (#2967)', () => {
  it('writes the tree by indentation, the root a circle, every label quoted', () => {
    expect(mindmapMermaid({ id: 'r', label: 'Launch', children: [
      { id: 'a', label: 'Build (v2): "fast"', children: [{ id: 'c', label: 'Code\nit', children: [] }] },
      { id: 'b', label: '', children: [] },
    ] })).toBe([
      'mindmap',
      '  root(("Launch"))',
      '    n1["Build (v2): #quot;fast#quot;"]',
      '      n2["Code it"]',
      '    n3[" "]',
      '',
    ].join('\n'));
  });
});
