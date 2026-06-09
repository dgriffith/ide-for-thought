import { describe, it, expect } from 'vitest';
import {
  skillInfoToToolDef,
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

describe('skillInfoToToolDef', () => {
  it('maps a SkillInfo into a renderer tool def with category from menu', () => {
    const def = skillInfoToToolDef(info());
    expect(def.category).toBe('research');
    expect(def.context).toEqual(['claimUnderCursor']);
    expect(def.web).toEqual({ defaultEnabled: true });
    expect(def.preferredModel).toBe('claude-opus-4-8');
    expect(def.outputMode).toBe('openConversation');
    expect(def.buildPrompt({})).toBe(''); // stub — never invoked in renderer
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

    // Hardcoded tools are never touched by skill sync.
    expect(ids).toContain('planning.steelman');

    // Clear skills.
    registerSkillInfos([]);
    expect(getAllToolInfos().some((t) => t.id === 'learning.s2')).toBe(false);
  });
});
