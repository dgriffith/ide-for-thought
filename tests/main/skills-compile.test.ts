import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { compileSkill } from '../../src/main/skills/compile';
import { parseSkill } from '../../src/main/skills/parse';
import { buildConversationPayload } from '../../src/main/tools/executor';
import { getTool, registerTool, unregisterTool } from '../../src/shared/tools/registry';
import { toolRequiresNote } from '../../src/shared/tools/types';
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
      body: 'You help.{{#if note}}{{#context}}Note: {{note.content}}{{/context}}{{/if}}',
      firstMessage: 'Go on.{{#if note}}{{#context}}Title: {{note.title}}{{/context}}{{/if}}',
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
    // Instructions and the visible first message carry no thoughtbase text (#2438)…
    expect(def.buildSystemPrompt!(ctx)).toBe('You help.');
    expect(def.buildFirstMessage!(ctx)).toBe('Go on.');
    // …the material from BOTH templates goes to the user turn, delimited.
    expect(def.buildUserContext!(ctx)).toBe(
      'Note: <thoughtbase-content kind="note">\nBODY\n</thoughtbase-content>\n\n'
        + 'Title: <thoughtbase-content kind="note-title">TITLE</thoughtbase-content>',
    );
    // No note → conditional collapses.
    expect(def.buildSystemPrompt!({})).toBe('You help.');
    expect(def.buildUserContext!({})).toBe('');
  });

  it('maps a one-shot newNote skill to buildPrompt only', () => {
    const def = compileSkill(skill({
      menu: 'Analysis',
      outputMode: 'newNote',
      outputNotePrefix: 'steelman',
      body: 'Steelman the passage.\n{{#context}}{{selection}}{{/context}}',
    }));
    expect(def.category).toBe('analysis');
    expect(def.outputNotePrefix).toBe('steelman');
    expect(def.buildSystemPrompt).toBeUndefined();
    expect(def.buildFirstMessage).toBeUndefined();
    expect(def.buildPrompt({ selectedText: 'X' })).toBe('Steelman the passage.');
    expect(def.buildUserContext!({ selectedText: 'X' }))
      .toBe('<thoughtbase-content kind="selection">\nX\n</thoughtbase-content>');
  });

  it('auto-routes a thoughtbase variable a skill left outside {{#context}} (user skills)', () => {
    const def = compileSkill(skill({ body: 'Summarize: {{note.content}}' }));
    const ctx = { fullNoteContent: 'SECRET-BODY' };
    expect(def.buildSystemPrompt!(ctx)).not.toContain('SECRET-BODY');
    expect(def.buildUserContext!(ctx)).toBe('<thoughtbase-content kind="note">\nSECRET-BODY\n</thoughtbase-content>');
  });

  it('treats a note-type parameter\'s companions as thoughtbase text', () => {
    const def = compileSkill(skill({
      body: 'Compare.{{#context}}{{param.other.content}}{{/context}}',
      parameters: [{ id: 'other', label: 'Other', type: 'note' }],
    }));
    const ctx = { parameterValues: { other: 'notes/b.md', 'other.content': 'B-BODY' } };
    expect(def.buildSystemPrompt!(ctx)).toBe('Compare.');
    expect(def.buildUserContext!(ctx)).toBe(
      '<thoughtbase-content kind="note" path="notes/b.md">\nB-BODY\n</thoughtbase-content>',
    );
  });
});

describe('compiled skill through the conversation payload builder', () => {
  it('produces the same payload shape as a hardcoded conversational tool', () => {
    const def = compileSkill(skill({
      body: 'SYS{{#context}}{{note.content}}{{/context}}',
      firstMessage: 'FIRST',
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
      // Carried so a conversation the skill launches can be labeled with its
      // name downstream (note-history causes, #1158).
      toolName: 'Sample',
      systemPrompt: 'SYS',
      firstMessage: 'FIRST',
      // The material rides separately, for the first user turn (#2438).
      skillContext: '<thoughtbase-content kind="note">\nC\n</thoughtbase-content>',
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

describe('requiresNote', () => {
  it('derives from context by default and the explicit override wins', () => {
    // Default: context:[fullNote] ⇒ needs a note.
    expect(toolRequiresNote(compileSkill(skill({ context: ['fullNote'] })))).toBe(true);
    // Whole-thoughtbase tool (no context) ⇒ available with no note.
    expect(toolRequiresNote(compileSkill(skill({ context: [] })))).toBe(false);
    // Override: reads the note when present but stays available without one.
    expect(toolRequiresNote(compileSkill(skill({ context: ['fullNote'], requiresNote: false })))).toBe(false);
  });

  it('keeps the stock Create Learning Journey available with no note (regression guard)', () => {
    // The reported bug: "To create a learning journey you have to have a note
    // open." The stock skill declares context:[fullNote] but must opt out.
    const md = fs.readFileSync(
      path.join(__dirname, '../../src/main/skills/stock/create-learning-journey.md'),
      'utf-8',
    );
    const { skill: parsed, errors } = parseSkill(md, 'stock', 'stock/create-learning-journey.md');
    expect(errors).toEqual([]);
    expect(toolRequiresNote(compileSkill(parsed!))).toBe(false);
  });
});

describe('registry round-trip', () => {
  it('registers a compiled skill so getTool finds it, and unregister removes it', () => {
    const def = compileSkill(skill({ id: 'learning.roundtrip', body: 'b' }));
    registerTool(def);
    try {
      expect(getTool('learning.roundtrip')).toBe(def);
    } finally {
      unregisterTool('learning.roundtrip');
    }
    expect(getTool('learning.roundtrip')).toBeUndefined();
  });
});
