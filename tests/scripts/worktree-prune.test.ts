/**
 * The agent-worktree prune classifier (#2391).
 *
 * The repo squash-merges, so a merged branch never looks merged to git's
 * ancestry checks — the classifier combines the PR state, patch equivalence
 * against origin/main, and ancestry. Getting it wrong in the loud direction
 * deletes someone's work, so every "keep" rule is pinned here next to the
 * "remove" ones, with injected facts instead of a live repo.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyWorktree,
  parseLockPid,
  parseWorktreeList,
  pickPr,
  type WorktreeFacts,
} from '../../scripts/lib/worktree-prune.mjs';

/** A clean, idle, unlocked worktree with one commit that is not on main. */
function facts(over: WorktreeFacts = {}): WorktreeFacts {
  return {
    dirty: false,
    branch: 'fix/1-thing',
    isAncestorOfMain: false,
    unmergedPatches: 1,
    mergeIsNoop: false,
    ghAvailable: true,
    pr: null,
    remoteBranchExists: true,
    locked: false,
    lockPidAlive: false,
    idleMinutes: 600,
    ...over,
  };
}

describe('removable', () => {
  it('squash-merged: PR MERGED even though its commits are not on main', () => {
    const d = classifyWorktree(
      facts({ pr: { state: 'MERGED', number: 42, headRefOid: 'abc' }, headInPr: true, remoteBranchExists: false }),
    );
    expect(d).toMatchObject({ action: 'remove', kind: 'landed', deleteBranch: true });
    expect(d.reason).toContain('#42 merged');
  });

  it('no commits of its own (HEAD is an ancestor of origin/main)', () => {
    expect(classifyWorktree(facts({ isAncestorOfMain: true, unmergedPatches: 0 })).action).toBe('remove');
  });

  it('patch-equivalent without gh: merging would not change main', () => {
    const d = classifyWorktree(facts({ ghAvailable: false, pr: undefined, mergeIsNoop: true }));
    expect(d).toMatchObject({ action: 'remove', kind: 'landed' });
  });

  it('patch-equivalent via git cherry', () => {
    expect(classifyWorktree(facts({ unmergedPatches: 0 })).action).toBe('remove');
  });

  it('detached HEAD with nothing of its own is removed, with no branch to delete', () => {
    const d = classifyWorktree(facts({ branch: null, isAncestorOfMain: true }));
    expect(d).toMatchObject({ action: 'remove', deleteBranch: false });
  });

  it('a missing directory is pruned', () => {
    expect(classifyWorktree({ missing: true })).toMatchObject({ action: 'remove', kind: 'missing' });
  });

  it('locked by a dead process: qualifies like any other', () => {
    const d = classifyWorktree(facts({ locked: true, lockPidAlive: false, idleMinutes: 1, isAncestorOfMain: true }));
    expect(d.action).toBe('remove');
  });

  it('locked by a live process but long idle: qualifies', () => {
    const d = classifyWorktree(
      facts({ locked: true, lockPidAlive: true, idleMinutes: 120, pr: { state: 'MERGED', number: 7 } }),
    );
    expect(d.action).toBe('remove');
  });

  it('never deletes main', () => {
    expect(classifyWorktree(facts({ branch: 'main', isAncestorOfMain: true })).deleteBranch).toBe(false);
  });
});

describe('kept', () => {
  it('dirty, even when the PR merged', () => {
    const d = classifyWorktree(facts({ dirty: true, pr: { state: 'MERGED', number: 1 }, isAncestorOfMain: true }));
    expect(d).toMatchObject({ action: 'keep', kind: 'dirty' });
  });

  it('unreadable status', () => {
    expect(classifyWorktree(facts({ dirty: undefined })).kind).toBe('unknown');
  });

  it('unmerged commits and no PR', () => {
    expect(classifyWorktree(facts())).toMatchObject({ action: 'keep', kind: 'unmerged' });
  });

  it('closed-unmerged PR with commits not on main', () => {
    const d = classifyWorktree(facts({ pr: { state: 'CLOSED', number: 9 }, remoteBranchExists: false }));
    expect(d).toMatchObject({ action: 'keep', kind: 'unmerged' });
    expect(d.reason).toContain('closed without merging');
  });

  it('closed-unmerged PR whose changes are on main anyway is removed', () => {
    expect(classifyWorktree(facts({ pr: { state: 'CLOSED', number: 9 }, mergeIsNoop: true })).action).toBe('remove');
  });

  it('open PR', () => {
    expect(classifyWorktree(facts({ pr: { state: 'OPEN', number: 3 } })).action).toBe('keep');
  });

  it('merged PR but HEAD has commits made after it', () => {
    const d = classifyWorktree(facts({ pr: { state: 'MERGED', number: 5, headRefOid: 'x' }, headInPr: false }));
    expect(d).toMatchObject({ action: 'keep', kind: 'unmerged' });
  });

  it('no gh: remote branch gone is not enough on its own', () => {
    const d = classifyWorktree(facts({ ghAvailable: false, pr: undefined, remoteBranchExists: false }));
    expect(d).toMatchObject({ action: 'keep', kind: 'unmerged' });
    expect(d.reason).toContain('gh is unavailable');
  });

  it('locked by a live process and recently active: probably an agent mid-task', () => {
    const d = classifyWorktree(facts({ locked: true, lockPidAlive: true, idleMinutes: 5, isAncestorOfMain: true }));
    expect(d).toMatchObject({ action: 'keep', kind: 'active' });
  });

  it('respects a custom idle threshold', () => {
    const f = facts({ locked: true, lockPidAlive: true, idleMinutes: 45, isAncestorOfMain: true });
    expect(classifyWorktree(f).action).toBe('remove');
    expect(classifyWorktree(f, { minIdleMinutes: 60 }).action).toBe('keep');
  });

  it('main and current worktrees are protected', () => {
    expect(classifyWorktree(facts({ isMain: true, isAncestorOfMain: true })).kind).toBe('protected');
    expect(classifyWorktree(facts({ isCurrent: true, isAncestorOfMain: true })).kind).toBe('protected');
  });

  it('no comparison against main possible', () => {
    const d = classifyWorktree(
      facts({ isAncestorOfMain: undefined, unmergedPatches: undefined, mergeIsNoop: undefined }),
    );
    expect(d).toMatchObject({ action: 'keep', kind: 'unknown' });
  });
});

describe('parsing', () => {
  it('parses porcelain worktree list', () => {
    const text = [
      'worktree /repo',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /repo/.claude/worktrees/agent-1',
      'HEAD bbb',
      'branch refs/heads/fix/a/b',
      'locked claude agent agent-1 (pid 14546 start Sun Sep 27 15:36:36 2026)',
      '',
      'worktree /repo/.claude/worktrees/agent-2',
      'HEAD ccc',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');
    const list = parseWorktreeList(text);
    expect(list).toHaveLength(3);
    expect(list[1]).toMatchObject({ branch: 'fix/a/b', locked: true, head: 'bbb' });
    expect(parseLockPid(list[1].lockReason)).toBe(14546);
    expect(list[2]).toMatchObject({ branch: null, detached: true, prunable: true });
  });

  it('parseLockPid tolerates a bare lock', () => {
    expect(parseLockPid(null)).toBeNull();
    expect(parseLockPid('manual lock')).toBeNull();
  });

  it('pickPr prefers OPEN, then MERGED', () => {
    expect(pickPr([])).toBeNull();
    expect(pickPr([{ state: 'CLOSED', number: 1 }, { state: 'MERGED', number: 2 }])?.number).toBe(2);
    expect(pickPr([{ state: 'MERGED', number: 2 }, { state: 'OPEN', number: 3 }])?.number).toBe(3);
  });
});
