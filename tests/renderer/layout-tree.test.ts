/**
 * Recursive editor-layout tree transforms (#813).
 */
import { describe, it, expect } from 'vitest';
import {
  leaf,
  splitLeaf,
  removeLeaf,
  collectGroupIds,
  isLayoutNode,
  type LayoutNode,
} from '../../src/renderer/lib/editor/layout-tree';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('splitLeaf', () => {
  it('wraps a lone leaf into a 50/50 binary split', () => {
    const next = splitLeaf(leaf('a'), 'a', 'horizontal', 'b');
    expect(next).toEqual({
      kind: 'split',
      direction: 'horizontal',
      children: [leaf('a'), leaf('b')],
      sizes: [0.5, 0.5],
    });
  });

  it('inserts a flat sibling when the parent runs the same direction', () => {
    const root = splitLeaf(leaf('a'), 'a', 'horizontal', 'b'); // [a|b]
    const next = splitLeaf(root, 'b', 'horizontal', 'c') as Extract<LayoutNode, { kind: 'split' }>;
    // Stays one horizontal split of three, not a nested split.
    expect(next.kind).toBe('split');
    expect(collectGroupIds(next)).toEqual(['a', 'b', 'c']);
    expect(next.children.every((c) => c.kind === 'leaf')).toBe(true);
    expect(sum(next.sizes)).toBeCloseTo(1, 6);
    // a kept its half; b's half was divided between b and c.
    expect(next.sizes[0]).toBeCloseTo(0.5, 6);
    expect(next.sizes[1]).toBeCloseTo(0.25, 6);
    expect(next.sizes[2]).toBeCloseTo(0.25, 6);
  });

  it('nests a split of the opposite direction', () => {
    const root = splitLeaf(leaf('a'), 'a', 'horizontal', 'b'); // [a|b]
    const next = splitLeaf(root, 'b', 'vertical', 'c') as Extract<LayoutNode, { kind: 'split' }>;
    expect(next.direction).toBe('horizontal');
    expect(next.children[0]).toEqual(leaf('a'));
    const nested = next.children[1] as Extract<LayoutNode, { kind: 'split' }>;
    expect(nested.kind).toBe('split');
    expect(nested.direction).toBe('vertical');
    expect(collectGroupIds(nested)).toEqual(['b', 'c']);
  });

  it('is a no-op for an unknown group id', () => {
    const root = leaf('a');
    expect(splitLeaf(root, 'zzz', 'horizontal', 'b')).toEqual(root);
  });

  it('does not mutate the original tree', () => {
    const root = splitLeaf(leaf('a'), 'a', 'horizontal', 'b');
    const snapshot = JSON.parse(JSON.stringify(root));
    splitLeaf(root, 'b', 'horizontal', 'c');
    expect(root).toEqual(snapshot);
  });
});

describe('removeLeaf', () => {
  it('returns null when removing the only leaf', () => {
    expect(removeLeaf(leaf('a'), 'a')).toBeNull();
  });

  it('collapses a two-child split into the surviving child', () => {
    const root = splitLeaf(leaf('a'), 'a', 'horizontal', 'b'); // [a|b]
    expect(removeLeaf(root, 'b')).toEqual(leaf('a'));
    expect(removeLeaf(root, 'a')).toEqual(leaf('b'));
  });

  it('keeps a three-way split as a split, renormalizing sizes', () => {
    let root = splitLeaf(leaf('a'), 'a', 'horizontal', 'b');
    root = splitLeaf(root, 'b', 'horizontal', 'c'); // [a|b|c]
    const next = removeLeaf(root, 'b') as Extract<LayoutNode, { kind: 'split' }>;
    expect(collectGroupIds(next)).toEqual(['a', 'c']);
    expect(sum(next.sizes)).toBeCloseTo(1, 6);
  });

  it('rebalances nested splits (collapse bubbles up)', () => {
    let root = splitLeaf(leaf('a'), 'a', 'horizontal', 'b'); // [a|b]
    root = splitLeaf(root, 'b', 'vertical', 'c'); // a | (b/c)
    // Removing c collapses the vertical split back to a leaf b, leaving [a|b].
    const next = removeLeaf(root, 'c') as Extract<LayoutNode, { kind: 'split' }>;
    expect(next.kind).toBe('split');
    expect(next.children).toEqual([leaf('a'), leaf('b')]);
  });

  it('returns the tree unchanged when the leaf is absent', () => {
    const root = splitLeaf(leaf('a'), 'a', 'horizontal', 'b');
    expect(removeLeaf(root, 'zzz')).toEqual(root);
  });
});

describe('collectGroupIds', () => {
  it('lists ids in left-to-right visual order', () => {
    let root = splitLeaf(leaf('a'), 'a', 'horizontal', 'b');
    root = splitLeaf(root, 'b', 'vertical', 'c'); // a | (b/c)
    expect(collectGroupIds(root)).toEqual(['a', 'b', 'c']);
  });
});

describe('isLayoutNode (restore validation, #816)', () => {
  it('accepts a valid leaf and a valid nested split', () => {
    expect(isLayoutNode(leaf('a'))).toBe(true);
    let root = splitLeaf(leaf('a'), 'a', 'horizontal', 'b');
    root = splitLeaf(root, 'b', 'vertical', 'c');
    expect(isLayoutNode(root)).toBe(true);
  });

  it('rejects non-objects and unknown kinds', () => {
    expect(isLayoutNode(null)).toBe(false);
    expect(isLayoutNode('leaf')).toBe(false);
    expect(isLayoutNode({})).toBe(false);
    expect(isLayoutNode({ kind: 'frob' })).toBe(false);
  });

  it('rejects a leaf without a string groupId', () => {
    expect(isLayoutNode({ kind: 'leaf' })).toBe(false);
    expect(isLayoutNode({ kind: 'leaf', groupId: 7 })).toBe(false);
  });

  it('rejects a split with a bad direction, no children, or mismatched sizes', () => {
    expect(isLayoutNode({ kind: 'split', direction: 'sideways', children: [leaf('a')], sizes: [1] })).toBe(false);
    expect(isLayoutNode({ kind: 'split', direction: 'horizontal', children: [], sizes: [] })).toBe(false);
    expect(isLayoutNode({
      kind: 'split', direction: 'horizontal',
      children: [leaf('a'), leaf('b')], sizes: [1], // sizes length ≠ children length
    })).toBe(false);
  });

  it('rejects a split whose child is itself malformed', () => {
    expect(isLayoutNode({
      kind: 'split', direction: 'vertical',
      children: [leaf('a'), { kind: 'leaf' }], sizes: [0.5, 0.5],
    })).toBe(false);
  });
});
