/**
 * The conversation list nests branches under their parents (#2970).
 */
import { describe, it, expect } from 'vitest';
import { branchStatus, nestBranches, openDescendants } from '../../../src/renderer/lib/conversations/branch-tree';
import type { Conversation } from '../../../src/shared/conversation';

const conv = (id: string, parentId?: string, outcome?: 'done' | 'stopped' | 'failed'): Conversation => ({
  id, contextBundle: {}, messages: [], status: 'active', startedAt: 't',
  ...(parentId ? { branch: { parentId, atMessage: 0, context: 'summary', ...(outcome ? { outcome } : {}) } } : {}),
});
const self = (c: Conversation) => c;

describe('nestBranches (#2970)', () => {
  it('puts each branch under its parent, a level deeper per generation, keeping order', () => {
    const list = [conv('a'), conv('b'), conv('a1', 'a'), conv('a1x', 'a1'), conv('b1', 'b'), conv('a2', 'a')];
    expect(nestBranches(list, self).map(({ item, depth }) => `${item.id}:${depth}`)).toEqual([
      'a:0', 'a1:1', 'a1x:2', 'a2:1', 'b:0', 'b1:1',
    ]);
  });

  it('a branch whose parent isn\'t open stands at the top; a loop loses nothing', () => {
    expect(nestBranches([conv('x', 'gone'), conv('y')], self).map((n) => n.depth)).toEqual([0, 0]);
    const loop = [conv('p', 'q'), conv('q', 'p')];
    expect(nestBranches(loop, self).map((n) => n.item.id).sort()).toEqual(['p', 'q']);
  });

  it('openDescendants finds branches and theirs, not siblings', () => {
    const list = [conv('a'), conv('a1', 'a'), conv('a1x', 'a1'), conv('b'), conv('b1', 'b')];
    expect(openDescendants(list, self, 'a').map((c) => c.id)).toEqual(['a1', 'a1x']);
    expect(openDescendants(list, self, 'a1x')).toEqual([]);
  });

  it('branchStatus: running while a turn runs, then how it last ended', () => {
    expect(branchStatus(conv('a'), true)).toBeNull();
    expect(branchStatus(conv('b', 'a'), false)).toBeNull();
    expect(branchStatus(conv('b', 'a', 'done'), true)).toBe('Running');
    expect(branchStatus(conv('b', 'a', 'done'), false)).toBe('Done');
    expect(branchStatus(conv('b', 'a', 'stopped'), false)).toBe('Stopped');
    expect(branchStatus(conv('b', 'a', 'failed'), false)).toBe('Failed');
  });
});
