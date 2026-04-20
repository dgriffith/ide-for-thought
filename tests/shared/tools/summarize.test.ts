import { describe, it, expect } from 'vitest';
import '../../../src/shared/tools/definitions/index';
import { getTool, getToolInfosByCategory } from '../../../src/shared/tools/registry';
import { buildConversationPayload } from '../../../src/main/tools/executor';

describe('learning.summarize (issue #176)', () => {
  it('is registered under the learning category', () => {
    const learningTools = getToolInfosByCategory('learning');
    expect(learningTools.find((t) => t.id === 'learning.summarize')).toBeDefined();
  });

  it('is a conversational tool with web on by default', () => {
    const tool = getTool('learning.summarize')!;
    expect(tool.outputMode).toBe('openConversation');
    expect(tool.web?.defaultEnabled).toBe(true);
    expect(tool.preferredModel).toBe('claude-sonnet-4-6');
  });

  it('system prompt embeds the note content when present', () => {
    const tool = getTool('learning.summarize')!;
    const payload = buildConversationPayload(
      tool,
      {},
      { context: { fullNoteContent: '# Nuclear Fusion\nFusion is when...', fullNoteTitle: 'Nuclear Fusion' } },
    );
    expect(payload.systemPrompt).toContain('Nuclear Fusion');
    expect(payload.systemPrompt).toContain('Fusion is when...');
    expect(payload.firstMessage).toBe('Summarize.');
  });

  it('system prompt still works when note content is absent', () => {
    const tool = getTool('learning.summarize')!;
    const payload = buildConversationPayload(tool, {}, { context: {} });
    expect(payload.systemPrompt).toMatch(/summariz/i);
    expect(payload.firstMessage).toBe('Summarize.');
  });
});
