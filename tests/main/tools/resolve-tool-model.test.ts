import { describe, it, expect } from 'vitest';
import { resolveToolModel } from '../../../src/main/tools/executor';

const tool = (id: string, preferredModel?: string) => ({ id, preferredModel });

describe('resolveToolModel (issue #169)', () => {
  it('returns undefined when nothing is set (caller falls back to global default)', () => {
    expect(resolveToolModel(tool('critique'), {})).toBeUndefined();
  });

  it('uses the tool author preference when no user override', () => {
    expect(
      resolveToolModel(tool('critique', 'claude-opus-4-7'), {}),
    ).toBe('claude-opus-4-7');
  });

  it('user override beats the tool author preference', () => {
    expect(
      resolveToolModel(
        tool('critique', 'claude-opus-4-7'),
        { toolModelOverrides: { critique: 'claude-haiku-4-5' } },
      ),
    ).toBe('claude-haiku-4-5');
  });

  it('per-invocation override beats everything', () => {
    expect(
      resolveToolModel(
        tool('critique', 'claude-opus-4-7'),
        { toolModelOverrides: { critique: 'claude-haiku-4-5' } },
        'claude-sonnet-4-6',
      ),
    ).toBe('claude-sonnet-4-6');
  });

  it('user override applies even when there is no tool preference', () => {
    expect(
      resolveToolModel(
        tool('summarize'),
        { toolModelOverrides: { summarize: 'claude-haiku-4-5' } },
      ),
    ).toBe('claude-haiku-4-5');
  });

  it('user override for a different tool is ignored', () => {
    expect(
      resolveToolModel(
        tool('critique', 'claude-opus-4-7'),
        { toolModelOverrides: { summarize: 'claude-haiku-4-5' } },
      ),
    ).toBe('claude-opus-4-7');
  });
});
