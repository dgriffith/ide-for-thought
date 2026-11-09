/**
 * "Ask in parallel" (#2974): the branches a choice makes, what each is sent,
 * and the join as plain text.
 */
import { describe, it, expect } from 'vitest';
import { joinedAnswersMarkdown, parallelBranches, parallelMessage } from '../../src/shared/conversation-parallel';

describe('parallelBranches', () => {
  it('models: one branch per model, labelled, repeats dropped, at most the limit', () => {
    const models = [{ id: 'a', label: 'Model A' }, { id: 'b', label: 'Model B' }, { id: 'a', label: 'Model A' }, { id: 'c', label: 'C' }];
    expect(parallelBranches({ mode: 'models', models }, 2)).toEqual([{ title: 'Model A', model: 'a' }, { title: 'Model B', model: 'b' }]);
  });

  it('perspectives: one per non-blank line, trimmed', () => {
    expect(parallelBranches({ mode: 'perspectives', perspectives: [' a skeptic ', '', 'an engineer'] }, 4))
      .toEqual([{ title: 'a skeptic', perspective: 'a skeptic' }, { title: 'an engineer', perspective: 'an engineer' }]);
  });

  it('attempts: numbered, clamped to the limit', () => {
    expect(parallelBranches({ mode: 'attempts', attempts: 9 }, 3).map((b) => b.title)).toEqual(['Attempt 1', 'Attempt 2', 'Attempt 3']);
    expect(parallelBranches({ mode: 'attempts', attempts: -1 }, 3)).toEqual([]);
  });
});

describe('parallelMessage', () => {
  it('a perspective asks the same message from it; "as …" isn\'t doubled', () => {
    expect(parallelMessage('Is it safe?', { title: 'x', perspective: 'a skeptic' })).toBe('Is it safe?\n\n(Answer as a skeptic.)');
    expect(parallelMessage('Is it safe?', { title: 'x', perspective: 'As an engineer' })).toBe('Is it safe?\n\n(Answer As an engineer.)');
    expect(parallelMessage('Is it safe?', { title: 'x', model: 'm' })).toBe('Is it safe?');
  });
});

describe('joinedAnswersMarkdown', () => {
  it('a section per branch, a stopped or failed one saying so', () => {
    expect(joinedAnswersMarkdown([
      { title: 'A', conversationId: 'b1', status: 'done', answer: 'Yes.' },
      { title: 'B', conversationId: 'b2', status: 'stopped', answer: '', note: 'stopped' },
    ])).toBe('### A\n\nYes.\n\n### B (stopped)\n\n_No answer._');
  });
});
