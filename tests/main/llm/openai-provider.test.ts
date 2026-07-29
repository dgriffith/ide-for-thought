/**
 * OpenAIProvider — wire-format translation behind the provider seam (BYOM #1495).
 *
 * The pure mappers (tools, reasoning effort, finish reason, usage, tool-arg
 * parsing) are unit-tested directly; `runTurn` / `complete` are driven through
 * an INJECTED fake OpenAI client (the constructor's test-only 3rd arg) so the
 * streamed-tool-call reassembly, text accumulation, stop-reason, and usage
 * mapping are exercised without a network call.
 */
import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import {
  OpenAIProvider,
  reasoningEffortFor,
  toChatTools,
  mapFinishReason,
  foldOpenAIUsage,
  parseToolArgs,
} from '../../../src/main/llm/provider/openai';
import type { ToolSpec } from '../../../src/main/llm/provider/types';

/** A fake OpenAI client: streaming `create` yields `streamChunks`, non-streaming
 *  returns `response`. */
function fakeClient(opts: { streamChunks?: unknown[]; response?: unknown }): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: { stream?: boolean }) => {
          if (params.stream) {
            return (async function* () {
              for (const c of opts.streamChunks ?? []) yield c;
            })();
          }
          return opts.response;
        },
      },
    },
    models: { list: async () => ({ data: [] }) },
  } as unknown as OpenAI;
}

describe('OpenAIProvider — pure mappers', () => {
  it('reasoningEffortFor maps neutral effort, clamping xhigh/max → high', () => {
    expect(reasoningEffortFor(undefined)).toBeUndefined();
    expect(reasoningEffortFor('low')).toBe('low');
    expect(reasoningEffortFor('medium')).toBe('medium');
    expect(reasoningEffortFor('high')).toBe('high');
    expect(reasoningEffortFor('xhigh')).toBe('high');
    expect(reasoningEffortFor('max')).toBe('high');
  });

  it('toChatTools translates a ToolSpec to an OpenAI function tool', () => {
    const spec: ToolSpec = {
      name: 'search',
      description: 'find things',
      input_schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    };
    expect(toChatTools([spec])).toEqual([
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'find things',
          parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
      },
    ]);
  });

  it('mapFinishReason: tool_calls → tool_use, everything else → end', () => {
    expect(mapFinishReason('tool_calls')).toBe('tool_use');
    expect(mapFinishReason('stop')).toBe('end');
    expect(mapFinishReason('length')).toBe('end');
    expect(mapFinishReason(null)).toBe('end');
  });

  it('foldOpenAIUsage maps prompt/completion tokens (cache fields zeroed)', () => {
    expect(foldOpenAIUsage({ prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 }))
      .toEqual({ inputTokens: 12, outputTokens: 7, cacheCreationTokens: 0, cacheReadTokens: 0 });
    expect(foldOpenAIUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
  });

  it('parseToolArgs parses JSON and tolerates malformed/empty', () => {
    expect(parseToolArgs('{"q":"hi"}')).toEqual({ q: 'hi' });
    expect(parseToolArgs('')).toEqual({});
    expect(parseToolArgs('{not json')).toEqual({});
  });
});

describe('OpenAIProvider — history shaping', () => {
  const provider = new OpenAIProvider('sk-test', undefined, fakeClient({}));

  it('ingestHistory wraps each seed turn as a one-message chunk', () => {
    const h = provider.ingestHistory([{ role: 'user', content: 'hi' }]);
    expect(h).toHaveLength(1);
    expect(h[0]).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('toolResultMessage emits one role:tool message per result', () => {
    const msg = provider.toolResultMessage([
      { toolUseId: 'call_1', content: 'ok', isError: false },
      { toolUseId: 'call_2', content: 'bad', isError: true },
    ]);
    expect(msg).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
      { role: 'tool', tool_call_id: 'call_2', content: 'bad' },
    ]);
  });
});

// Chunk builders keep the deeply-nested OpenAI stream shape readable.
const chunk = (delta: unknown, finish: string | null = null) => ({ choices: [{ delta, finish_reason: finish }] });
const usageChunk = (usage: unknown) => ({ choices: [], usage });

describe('OpenAIProvider — runTurn (injected stream)', () => {
  it('accumulates text + a fragmented tool call, and maps stop/usage', async () => {
    const streamChunks = [
      chunk({ content: 'Hel' }),
      chunk({ content: 'lo' }),
      chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] }, 'tool_calls'),
      usageChunk({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
    ];
    const provider = new OpenAIProvider('sk-test', undefined, fakeClient({ streamChunks }));

    const deltas: string[] = [];
    const toolStarts: string[] = [];
    const res = await provider.runTurn(
      {
        model: 'gpt-5',
        system: 'sys',
        history: provider.ingestHistory([{ role: 'user', content: 'hi' }]),
        tools: [],
        web: { enabled: false },
        maxTokens: 1000,
      },
      { onTextDelta: (d) => deltas.push(d), onToolCallStart: (n) => toolStarts.push(n) },
    );

    expect(res.text).toBe('Hello');
    expect(deltas.join('')).toBe('Hello');
    expect(res.toolCalls).toEqual([{ id: 'call_1', name: 'search', input: { q: 'hi' } }]);
    expect(toolStarts).toEqual(['search']); // indicator fired once, when the name arrived
    expect(res.stopReason).toBe('tool_use');
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 });
    expect(res.citations).toEqual([]);
  });

  it('a plain text turn stops with "end"', async () => {
    const provider = new OpenAIProvider('sk-test', undefined, fakeClient({
      streamChunks: [chunk({ content: 'done' }, 'stop'), usageChunk({ prompt_tokens: 3, completion_tokens: 1 })],
    }));
    const res = await provider.runTurn(
      { model: 'gpt-5', system: 's', history: [], tools: [], web: { enabled: false }, maxTokens: 100 },
      {},
    );
    expect(res.text).toBe('done');
    expect(res.toolCalls).toEqual([]);
    expect(res.stopReason).toBe('end');
  });
});

describe('OpenAIProvider — complete (non-streaming)', () => {
  it('returns the message content + usage', async () => {
    const provider = new OpenAIProvider('sk-test', undefined, fakeClient({
      response: { choices: [{ message: { content: 'the answer' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } },
    }));
    const res = await provider.complete({ model: 'gpt-5', messages: [{ role: 'user', content: 'q' }], maxTokens: 100 });
    expect(res.text).toBe('the answer');
    expect(res.usage.inputTokens).toBe(4);
    expect(res.usage.outputTokens).toBe(2);
  });
});
