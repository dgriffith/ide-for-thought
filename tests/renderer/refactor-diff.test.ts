import { describe, it, expect } from 'vitest';
import { refactorVerb, changedLines } from '../../src/renderer/lib/components/refactor-diff';

describe('refactorVerb', () => {
  it('is Rename when only the basename changes', () => {
    expect(refactorVerb('notes/raft.md', 'notes/raft-consensus.md')).toBe('Rename');
    expect(refactorVerb('raft.md', 'paxos.md')).toBe('Rename');
  });
  it('is Move when the folder changes', () => {
    expect(refactorVerb('raft.md', 'notes/algorithms/raft.md')).toBe('Move');
    expect(refactorVerb('a/x.md', 'b/x.md')).toBe('Move');
  });
});

describe('changedLines', () => {
  it('surfaces only the lines that differ', () => {
    const before = '# Note\n\nSee [[raft]] for details.\n\nUnrelated line.';
    const after = '# Note\n\nSee [[raft-consensus]] for details.\n\nUnrelated line.';
    const out = changedLines(before, after);
    expect(out).toHaveLength(1);
    expect(out[0].before).toContain('[[raft]]');
    expect(out[0].after).toContain('[[raft-consensus]]');
  });

  it('is empty when nothing changed', () => {
    expect(changedLines('same\ntext', 'same\ntext')).toEqual([]);
  });

  it('handles multiple changed lines', () => {
    const out = changedLines('[[a]]\nx\n[[a]]', '[[b]]\nx\n[[b]]');
    expect(out).toHaveLength(2);
    expect(out.every((l) => l.after.includes('[[b]]'))).toBe(true);
  });
});
