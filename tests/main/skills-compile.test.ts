import { describe, it, expect } from 'vitest';
import { compileSkill } from '../../src/main/skills/compile';
import { buildConversationPayload } from '../../src/main/tools/executor';
import { getTool, registerTool, unregisterTool } from '../../src/shared/tools/registry';
import type { SkillDef } from '../../src/shared/skills/types';

function skill(overrides: Partial<SkillDef> = {}): SkillDef {
  return {
    id: 'learning.sample',
    name: 'Sample',
    description: 'a sample',
    longDescription: 'a longer description',
    menu: 'Learning',
    outputMode: 'openConversation',
    context: ['fullNote'],
    parameters: [],
    tools: [],
    web: false,
    requiresSelection: false,
    firstMessage: '',
    body: '',
    source: 'stock',
    filePath: 'stock/sample.md',
    ...overrides,
  };
}

describe('compileSkill', () => {
  it('maps a conversation skill and renders its templates', () => {
    const def = compileSkill(skill({
      body: 'You help. {{#if note}}Note: {{note.content}}{{/if}}',
      firstMessage: 'Go on {{note.title}}',
      web: true,
      model: 'claude-opus-4-8',
      slashCommand: '/sample',
      tools: ['ask_user', 'bogus'],
    }));

    expect(def.category).toBe('learning');
    expect(def.outputMode).toBe('openConversation');
    expect(def.web).toEqual({ defaultEnabled: true });
    expect(def.preferredModel).toBe('claude-opus-4-8');
    expect(def.requiresTools).toEqual(['ask_user']); // unknown "bogus" dropped

    const ctx = { fullNoteContent: 'BODY', fullNoteTitle: 'TITLE' };
    expect(def.buildSystemPrompt!(ctx)).toBe('You help. Note: BODY');
    expect(def.buildFirstMessage!(ctx)).toBe('Go on TITLE');
    // No note → conditional collapses.
    expect(def.buildSystemPrompt!({})).toBe('You help. ');
  });

  it('maps a one-shot newNote skill to buildPrompt only', () => {
    const def = compileSkill(skill({
      menu: 'Analysis',
      outputMode: 'newNote',
      outputNotePrefix: 'steelman',
      body: 'Steelman: {{selection}}',
    }));
    expect(def.category).toBe('analysis');
    expect(def.outputNotePrefix).toBe('steelman');
    expect(def.buildSystemPrompt).toBeUndefined();
    expect(def.buildFirstMessage).toBeUndefined();
    expect(def.buildPrompt({ selectedText: 'X' })).toBe('Steelman: X');
  });
});

describe('compiled skill through the conversation payload builder', () => {
  it('produces the same payload shape as a hardcoded conversational tool', () => {
    const def = compileSkill(skill({
      body: 'SYS {{note.content}}',
      firstMessage: 'FIRST {{note.title}}',
      web: true,
      model: 'claude-opus-4-8',
    }));
    const payload = buildConversationPayload(
      def,
      { model: 'claude-sonnet-4-6', toolModelOverrides: {} },
      { context: { fullNoteContent: 'C', fullNoteTitle: 'T' } },
    );
    expect(payload).toEqual({
      toolId: 'learning.sample',
      systemPrompt: 'SYS C',
      firstMessage: 'FIRST T',
      model: 'claude-opus-4-8', // differs from default → pinned
      webEnabled: true,
    });
  });

  it('omits model when it equals the global default', () => {
    const def = compileSkill(skill({ body: 'b', model: 'claude-sonnet-4-6' }));
    const payload = buildConversationPayload(
      def,
      { model: 'claude-sonnet-4-6', toolModelOverrides: {} },
      { context: {} },
    );
    expect(payload.model).toBeUndefined();
  });
});

describe('registry round-trip (coexistence with hardcoded tools)', () => {
  it('registers a compiled skill so getTool finds it', () => {
    const def = compileSkill(skill({ id: 'learning.roundtrip', body: 'b' }));
    registerTool(def);
    try {
      expect(getTool('learning.roundtrip')).toBe(def);
      // A hardcoded tool registered via static import is still present.
      expect(getTool('planning.steelman')).toBeDefined();
    } finally {
      unregisterTool('learning.roundtrip');
    }
    expect(getTool('learning.roundtrip')).toBeUndefined();
  });
});
