/**
 * AnthropicProvider — pure history-shaping methods (#2024).
 *
 * Unlike OpenAI/Google, AnthropicProvider's constructor takes no injectable
 * client, so `runTurn`/`complete` are exercised only through the mocked-SDK
 * integration test (`conversation-tool-dispatch.test.ts`). `compactToolUseInputs`
 * doesn't touch `this.client` at all, though — a plain instance is enough.
 */
import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from '../../../src/main/llm/provider/anthropic';

describe('AnthropicProvider — compactToolUseInputs (#2024)', () => {
  const provider = new AnthropicProvider('sk-test');

  it('stubs a matching tool_use block\'s input, leaves a non-matching one and a text block alone', () => {
    const assistant = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'checking...' },
        { type: 'tool_use', id: 'tu-1', name: 'propose_notes', input: { big: 'payload' } },
        { type: 'tool_use', id: 'tu-2', name: 'read_note', input: { relative_path: 'a.md' } },
      ],
    };
    const message = assistant as unknown as ReturnType<typeof provider.ingestHistory>[number];

    const next = provider.compactToolUseInputs(message, new Set(['tu-1']), { compacted: true });

    expect(next).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'checking...' },
        { type: 'tool_use', id: 'tu-1', name: 'propose_notes', input: { compacted: true } },
        { type: 'tool_use', id: 'tu-2', name: 'read_note', input: { relative_path: 'a.md' } },
      ],
    });
  });

  it('is a no-op with an empty id set', () => {
    const assistant = { role: 'assistant', content: [{ type: 'text', text: 'hi' }] };
    const message = assistant as unknown as ReturnType<typeof provider.ingestHistory>[number];
    expect(provider.compactToolUseInputs(message, new Set(), {})).toBe(message);
  });
});
