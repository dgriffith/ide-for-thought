import { describe, it, expect } from 'vitest';
import {
  skillInfoToToolMeta,
  registerSkillInfos,
  getAllToolInfos,
} from '../../src/renderer/lib/tools/tool-registry';
import type { SkillInfo } from '../../src/shared/skills/types';

function info(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    id: 'research.sample',
    name: 'Sample',
    description: 'desc',
    longDescription: 'long desc',
    menu: 'Research',
    outputMode: 'openConversation',
    context: ['claimUnderCursor'],
    parameters: [],
    web: true,
    model: 'claude-opus-4-8',
    slashCommand: '/sample',
    requiresSelection: false,
    source: 'user',
    ...overrides,
  };
}

describe('skillInfoToToolMeta', () => {
  it('maps a SkillInfo into renderer tool metadata with category from menu', () => {
    const meta = skillInfoToToolMeta(info());
    expect(meta.category).toBe('research');
    expect(meta.context).toEqual(['claimUnderCursor']);
    expect(meta.web).toEqual({ defaultEnabled: true });
    expect(meta.preferredModel).toBe('claude-opus-4-8');
    expect(meta.outputMode).toBe('openConversation');
  });

  it('carries no prompt builders at all (#2235)', () => {
    // This used to assert `buildPrompt({}) === ''` — pinning a stub that
    // existed only because the renderer was forced to satisfy a required field
    // it cannot fill. The absence is the point now: renderer metadata has no
    // builders, so there is nothing to call and nothing to return '' from.
    const meta = skillInfoToToolMeta(info()) as Record<string, unknown>;
    expect(meta.buildPrompt).toBeUndefined();
    expect(meta.buildSystemPrompt).toBeUndefined();
    expect(meta.buildFirstMessage).toBeUndefined();
  });
});

describe('registerSkillInfos', () => {
  it('adds skills to the registry and replaces them on re-sync', () => {
    registerSkillInfos([info({ id: 'analysis.s1', name: 'S1', menu: 'Analysis' })]);
    expect(getAllToolInfos().find((t) => t.id === 'analysis.s1')?.category).toBe('analysis');

    // Re-sync with a different set drops the previous skill.
    registerSkillInfos([info({ id: 'learning.s2', name: 'S2', menu: 'Learning' })]);
    const ids = getAllToolInfos().map((t) => t.id);
    expect(ids).toContain('learning.s2');
    expect(ids).not.toContain('analysis.s1');

    // Clear skills.
    registerSkillInfos([]);
    expect(getAllToolInfos().some((t) => t.id === 'learning.s2')).toBe(false);
  });
});
