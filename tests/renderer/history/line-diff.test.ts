/**
 * LCS line diff for the History panel (#1158). Unlike the index-wise
 * `changedLines`, an inserted line must NOT make every following line read as
 * changed — that's the whole reason this exists.
 */
import { describe, it, expect } from 'vitest';
import { diffLines, diffStats } from '../../../src/renderer/lib/history/line-diff';

describe('diffLines (#1158)', () => {
  it('identical text is all context', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nc');
    expect(d.every((l) => l.type === 'context')).toBe(true);
    expect(diffStats(d)).toEqual({ added: 0, removed: 0 });
  });

  it('an inserted line keeps surrounding lines as context (not a cascade)', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nNEW\nc');
    expect(d).toEqual([
      { type: 'context', text: 'a' },
      { type: 'context', text: 'b' },
      { type: 'add', text: 'NEW' },
      { type: 'context', text: 'c' },
    ]);
    expect(diffStats(d)).toEqual({ added: 1, removed: 0 });
  });

  it('a deleted line shows one remove, rest context', () => {
    const d = diffLines('a\nb\nc', 'a\nc');
    expect(d).toEqual([
      { type: 'context', text: 'a' },
      { type: 'remove', text: 'b' },
      { type: 'context', text: 'c' },
    ]);
  });

  it('a replaced line is a remove + an add', () => {
    const d = diffLines('a\nOLD\nc', 'a\nNEW\nc');
    expect(d.map((l) => `${l.type}:${l.text}`)).toEqual([
      'context:a', 'remove:OLD', 'add:NEW', 'context:c',
    ]);
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 });
  });

  it('empty ⇄ content is a single pure add / remove (no phantom blank line)', () => {
    expect(diffLines('', 'hello')).toEqual([{ type: 'add', text: 'hello' }]);
    expect(diffLines('hello', '')).toEqual([{ type: 'remove', text: 'hello' }]);
  });
});
