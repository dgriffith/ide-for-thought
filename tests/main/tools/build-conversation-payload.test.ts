import { describe, it, expect } from 'vitest';
import { buildConversationPayload } from '../../../src/main/tools/executor';
import type { ThinkingToolDef, ToolContext } from '../../../src/shared/tools/types';

function makeTool(partial: Partial<ThinkingToolDef> = {}): ThinkingToolDef {
  return {
    id: 'learning.summarize',
    name: 'Summarize',
    category: 'learning',
    description: '',
    longDescription: '',
    context: ['fullNote'],
    outputMode: 'openConversation',
    buildPrompt: () => '',
    buildSystemPrompt: () => 'System prompt.',
    buildFirstMessage: () => 'Summarize.',
    ...partial,
  };
}

describe('buildConversationPayload (issue #179)', () => {
  it('returns system prompt + first message + tool id', () => {
    const payload = buildConversationPayload(makeTool(), {}, { context: {} });
    expect(payload.toolId).toBe('learning.summarize');
    expect(payload.systemPrompt).toBe('System prompt.');
    expect(payload.firstMessage).toBe('Summarize.');
  });

  it('threads tool context through buildSystemPrompt and buildFirstMessage', () => {
    const tool = makeTool({
      buildSystemPrompt: (ctx: ToolContext) => `Note body: ${ctx.fullNoteContent ?? ''}`,
      buildFirstMessage: (ctx: ToolContext) => `Summarize ${ctx.fullNoteTitle ?? ''}.`,
    });
    const payload = buildConversationPayload(
      tool,
      {},
      { context: { fullNoteContent: 'Hello', fullNoteTitle: 'My Note' } },
    );
    expect(payload.systemPrompt).toBe('Note body: Hello');
    expect(payload.firstMessage).toBe('Summarize My Note.');
  });

  it('omits firstMessage when buildFirstMessage is undefined', () => {
    const tool = makeTool({ buildFirstMessage: undefined });
    const payload = buildConversationPayload(tool, {}, { context: {} });
    expect(payload.firstMessage).toBe('');
  });

  it('carries preferredModel into the payload when no user override', () => {
    const tool = makeTool({ preferredModel: 'claude-opus-4-7' });
    const payload = buildConversationPayload(tool, {}, { context: {} });
    expect(payload.model).toBe('claude-opus-4-7');
  });

  it('user override beats preferredModel (matches resolveToolModel precedence)', () => {
    const tool = makeTool({ preferredModel: 'claude-opus-4-7' });
    const payload = buildConversationPayload(
      tool,
      { toolModelOverrides: { 'learning.summarize': 'claude-haiku-4-5' } },
      { context: {} },
    );
    expect(payload.model).toBe('claude-haiku-4-5');
  });

  it('omits model entirely when nothing is set (caller falls back to global default)', () => {
    const payload = buildConversationPayload(makeTool(), {}, { context: {} });
    expect(payload.model).toBeUndefined();
  });

  it('surfaces the tool author web hint (defaults to false)', () => {
    expect(buildConversationPayload(makeTool(), {}, { context: {} }).webEnabled).toBe(false);
    expect(
      buildConversationPayload(
        makeTool({ web: { defaultEnabled: true } }),
        {},
        { context: {} },
      ).webEnabled,
    ).toBe(true);
  });

  it('throws for non-conversational tools', () => {
    expect(() =>
      buildConversationPayload(makeTool({ outputMode: 'newNote' }), {}, { context: {} }),
    ).toThrow(/not conversational/);
  });

  it('throws when buildSystemPrompt is missing', () => {
    expect(() =>
      buildConversationPayload(makeTool({ buildSystemPrompt: undefined }), {}, { context: {} }),
    ).toThrow(/buildSystemPrompt/);
  });
});
