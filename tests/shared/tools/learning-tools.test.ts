import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { loadSkillCatalog } from '../../../src/main/skills/loader';
import { compileSkill } from '../../../src/main/skills/compile';
import { buildConversationPayload } from '../../../src/main/tools/executor';
import type { ThinkingToolDef } from '../../../src/shared/tools/types';
import type { SkillDef } from '../../../src/shared/skills/types';

// Learning tools were migrated from hardcoded .ts to stock skill files (#626).
// These tests now exercise the compiled stock skills end-to-end.
const BATCH = [
  'learning.summarize',
  'learning.explain-like-im',
  'learning.give-examples',
  'learning.define-terms',
  'learning.find-prerequisites',
  'learning.quiz-me',
  'learning.find-counterexamples',
  'learning.create-learning-journey',
  'learning.deep-dive',
];

let skills: Map<string, SkillDef>;
let defs: Map<string, ThinkingToolDef>;

beforeAll(async () => {
  const cat = await loadSkillCatalog(path.join(__dirname, '__no_user_skills__'));
  expect(cat.errors).toEqual([]);
  skills = new Map(cat.skills.map((s) => [s.id, s]));
  defs = new Map(cat.skills.map((s) => [s.id, compileSkill(s)]));
});

/** The migrated param skills carry the phrase/directive in the option value;
 *  look it up by the human label so tests don't hardcode long strings. */
function optionValue(id: string, labelFragment: string): string {
  const param = skills.get(id)!.parameters[0];
  const opt = param.options!.find((o) => o.label.includes(labelFragment));
  if (!opt) throw new Error(`no option matching "${labelFragment}" on ${id}`);
  return opt.value;
}

describe('Learning skills (migrated from #180–#186 tools)', () => {
  it('all nine load as stock Learning skills', () => {
    for (const id of BATCH) {
      const s = skills.get(id);
      expect(s, id).toBeDefined();
      expect(s!.source).toBe('stock');
      expect(s!.menu).toBe('Learning');
    }
  });

  it.each(BATCH)('%s is conversational + web-on with a model and slash command', (id) => {
    const tool = defs.get(id)!;
    expect(tool.outputMode).toBe('openConversation');
    expect(tool.web?.defaultEnabled).toBe(true);
    expect(tool.preferredModel).toMatch(/^claude-(sonnet|opus|haiku)-/);
    expect(tool.buildSystemPrompt).toBeDefined();
    expect(tool.buildFirstMessage).toBeDefined();
    expect(tool.slashCommand).toMatch(/^\//);
  });

  it('create-learning-journey is Opus-preferred (richer planning)', () => {
    expect(defs.get('learning.create-learning-journey')!.preferredModel).toBe('claude-opus-4-7');
  });

  it('deep-dive is marked requiresSelection', () => {
    expect(defs.get('learning.deep-dive')!.requiresSelection).toBe(true);
  });

  it('deep-dive threads selected text + depth into system prompt and first message', () => {
    const payload = buildConversationPayload(
      defs.get('learning.deep-dive')!,
      {},
      {
        context: {
          selectedText: 'entropy',
          fullNoteContent: 'Thermodynamics notes.',
          parameterValues: { depth: optionValue('learning.deep-dive', 'Exhaustive') },
        },
      },
    );
    expect(payload.systemPrompt).toContain('entropy');
    expect(payload.systemPrompt.toLowerCase()).toContain('multi-section');
    expect(payload.firstMessage).toBe('Explain "entropy" in depth.');
  });

  it('explain-like-im threads audience into system + first message', () => {
    const payload = buildConversationPayload(
      defs.get('learning.explain-like-im')!,
      {},
      { context: { fullNoteContent: 'Body.', parameterValues: { audience: optionValue('learning.explain-like-im', 'Child') } } },
    );
    expect(payload.systemPrompt).toContain('8-year-old');
    expect(payload.firstMessage).toContain('8-year-old');
  });

  it('explain-like-im default audience option is the undergrad phrase', () => {
    // The default now lives on the parameter (the UI always sends it), rather
    // than a builder fallback. Rendering with the default value yields undergrad.
    const def = defs.get('learning.explain-like-im')!;
    const dflt = skills.get('learning.explain-like-im')!.parameters[0].defaultValue!;
    expect(dflt).toContain('undergrad');
    const payload = buildConversationPayload(def, {}, { context: { fullNoteContent: 'Body.', parameterValues: { audience: dflt } } });
    expect(payload.systemPrompt).toContain('undergrad');
    expect(payload.firstMessage).toContain('undergrad');
  });

  it('quiz-me threads difficulty into the system prompt', () => {
    const payload = buildConversationPayload(
      defs.get('learning.quiz-me')!,
      {},
      { context: { fullNoteContent: 'Body.', parameterValues: { difficulty: optionValue('learning.quiz-me', 'Synthesis') } } },
    );
    expect(payload.systemPrompt).toMatch(/cross-topic synthesis|stress cases/i);
    expect(payload.firstMessage).toBe('Quiz me.');
  });

  it('give-examples, define-terms, find-prerequisites, find-counterexamples embed note content', () => {
    for (const id of ['learning.give-examples', 'learning.define-terms', 'learning.find-prerequisites', 'learning.find-counterexamples']) {
      const payload = buildConversationPayload(
        defs.get(id)!,
        {},
        { context: { fullNoteContent: 'distinctive-body-token', fullNoteTitle: 'Important Note' } },
      );
      expect(payload.systemPrompt, id).toContain('distinctive-body-token');
      expect(payload.systemPrompt, id).toContain('Important Note');
    }
  });

  it('summarize embeds note content and auto-fires "Summarize."', () => {
    const payload = buildConversationPayload(
      defs.get('learning.summarize')!,
      {},
      { context: { fullNoteContent: 'Fusion is when...', fullNoteTitle: 'Nuclear Fusion' } },
    );
    expect(payload.systemPrompt).toContain('Nuclear Fusion');
    expect(payload.systemPrompt).toContain('Fusion is when...');
    expect(payload.firstMessage).toBe('Summarize.');
  });
});
