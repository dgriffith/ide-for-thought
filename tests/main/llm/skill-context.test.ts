/**
 * `withSkillContext` — the skill's material goes at the head of the first
 * user turn (#2438).
 */
import { describe, it, expect } from 'vitest';
import { withSkillContext } from '../../../src/main/llm/skill-context';

const CTX = '<thoughtbase-content kind="note" path="a.md">\nBODY\n</thoughtbase-content>';

describe('withSkillContext', () => {
  it('prepends the context to the first user turn', () => {
    const out = withSkillContext([{ role: 'user' as const, content: 'Summarize.' }], CTX);
    expect(out).toEqual([{ role: 'user', content: `${CTX}\n\nSummarize.` }]);
  });

  it('uses the context alone when the first user turn is empty', () => {
    expect(withSkillContext([{ role: 'user' as const, content: '  ' }], CTX)).toEqual([{ role: 'user', content: CTX }]);
  });

  it('attaches to the FIRST user turn only, on every send of a multi-turn conversation', () => {
    const history = [
      { role: 'user' as const, content: 'Summarize.' },
      { role: 'assistant' as const, content: 'Here it is.' },
      { role: 'user' as const, content: 'Shorter.' },
    ];
    const out = withSkillContext(history, CTX);
    expect(out[0]!.content).toBe(`${CTX}\n\nSummarize.`);
    expect(out.slice(1)).toEqual(history.slice(1));
  });

  it('inserts a user turn when the history starts with the assistant', () => {
    const out = withSkillContext([{ role: 'assistant' as const, content: 'Hi.' }], CTX);
    expect(out).toEqual([{ role: 'user', content: CTX }, { role: 'assistant', content: 'Hi.' }]);
  });

  it('is a no-op without context, and never mutates its input', () => {
    const history = [{ role: 'user' as const, content: 'x' }];
    expect(withSkillContext(history, undefined)).toEqual(history);
    expect(withSkillContext(history, '   ')).toEqual(history);
    withSkillContext(history, CTX);
    expect(history).toEqual([{ role: 'user', content: 'x' }]);
  });

  it('keeps extra fields on the message it rewrites', () => {
    const out = withSkillContext([{ role: 'user' as const, content: 'x', id: 7 }], CTX);
    expect(out[0]).toEqual({ role: 'user', content: `${CTX}\n\nx`, id: 7 });
  });
});
