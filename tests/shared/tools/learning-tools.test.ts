import { describe, it, expect } from 'vitest';
import '../../../src/shared/tools/definitions/index';
import { getTool, getToolInfosByCategory } from '../../../src/shared/tools/registry';
import { buildConversationPayload } from '../../../src/main/tools/executor';

const BATCH = [
  'learning.summarize',
  'learning.explain-like-im',
  'learning.give-examples',
  'learning.define-terms',
  'learning.find-prerequisites',
  'learning.quiz-me',
  'learning.find-counterexamples',
];

describe('Learning tools batch (issues #180, #181, #183, #184, #185, #186)', () => {
  it('all tools are registered under the learning category', () => {
    const ids = getToolInfosByCategory('learning').map((t) => t.id);
    for (const id of BATCH) {
      expect(ids).toContain(id);
    }
  });

  it.each(BATCH)('%s is conversational, web-on, Sonnet-preferred', (id) => {
    const tool = getTool(id)!;
    expect(tool.outputMode).toBe('openConversation');
    expect(tool.web?.defaultEnabled).toBe(true);
    expect(tool.preferredModel).toBe('claude-sonnet-4-6');
    expect(tool.buildSystemPrompt).toBeDefined();
    expect(tool.buildFirstMessage).toBeDefined();
  });

  it.each(BATCH)('%s has a slash command', (id) => {
    const tool = getTool(id)!;
    expect(tool.slashCommand).toMatch(/^\//);
  });

  it('explain-like-im threads audience into system + first message', () => {
    const tool = getTool('learning.explain-like-im')!;
    const payload = buildConversationPayload(
      tool,
      {},
      { context: { fullNoteContent: 'Body.', parameterValues: { audience: 'child' } } },
    );
    expect(payload.systemPrompt).toContain('8-year-old');
    expect(payload.firstMessage).toContain('8-year-old');
  });

  it('explain-like-im defaults to undergrad when audience is unset', () => {
    const tool = getTool('learning.explain-like-im')!;
    const payload = buildConversationPayload(
      tool,
      {},
      { context: { fullNoteContent: 'Body.' } },
    );
    expect(payload.systemPrompt).toContain('undergrad');
    expect(payload.firstMessage).toContain('undergrad');
  });

  it('quiz-me threads difficulty into the system prompt', () => {
    const tool = getTool('learning.quiz-me')!;
    const payload = buildConversationPayload(
      tool,
      {},
      { context: { fullNoteContent: 'Body.', parameterValues: { difficulty: 'synthesis' } } },
    );
    expect(payload.systemPrompt).toMatch(/cross-topic synthesis|stress cases/i);
    expect(payload.firstMessage).toBe('Quiz me.');
  });

  it('give-examples, define-terms, find-prerequisites, find-counterexamples embed note content', () => {
    for (const id of ['learning.give-examples', 'learning.define-terms', 'learning.find-prerequisites', 'learning.find-counterexamples']) {
      const tool = getTool(id)!;
      const payload = buildConversationPayload(
        tool,
        {},
        { context: { fullNoteContent: 'distinctive-body-token', fullNoteTitle: 'Important Note' } },
      );
      expect(payload.systemPrompt).toContain('distinctive-body-token');
      expect(payload.systemPrompt).toContain('Important Note');
    }
  });
});
