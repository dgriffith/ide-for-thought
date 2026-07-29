/**
 * GoogleProvider — Gemini wire-format translation behind the provider seam
 * (BYOM #1496). Pure mappers are tested directly; `runTurn` / `complete` run
 * through an INJECTED fake GoogleGenAI client so streaming accumulation,
 * function-call handling, the name-encoded tool id round-trip, and usage
 * mapping are exercised without a network call.
 */
import { describe, it, expect } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import {
  GoogleProvider,
  thinkingBudgetFor,
  foldGeminiUsage,
  encodeToolId,
  decodeToolId,
} from '../../../src/main/llm/provider/google';

/** A fake GoogleGenAI: streaming yields `streamChunks`, non-streaming returns
 *  `response`. */
function fakeAi(opts: { streamChunks?: unknown[]; response?: unknown }): GoogleGenAI {
  return {
    models: {
      generateContentStream: async () =>
        (async function* () {
          for (const c of opts.streamChunks ?? []) yield c;
        })(),
      generateContent: async () => opts.response,
      list: async () => ({ page: [] }),
    },
  } as unknown as GoogleGenAI;
}

describe('GoogleProvider — pure mappers', () => {
  it('thinkingBudgetFor maps neutral effort to a token budget', () => {
    expect(thinkingBudgetFor(undefined)).toBeUndefined();
    expect(thinkingBudgetFor('low')).toBe(2048);
    expect(thinkingBudgetFor('medium')).toBe(8192);
    expect(thinkingBudgetFor('high')).toBe(16384);
    expect(thinkingBudgetFor('xhigh')).toBe(16384);
    expect(thinkingBudgetFor('max')).toBe(16384);
  });

  it('foldGeminiUsage maps prompt/candidate token counts', () => {
    expect(foldGeminiUsage({ promptTokenCount: 9, candidatesTokenCount: 4 }))
      .toEqual({ inputTokens: 9, outputTokens: 4, cacheCreationTokens: 0, cacheReadTokens: 0 });
    expect(foldGeminiUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
  });

  it('encode/decode tool id round-trips name (with and without a call id)', () => {
    expect(encodeToolId('search', undefined)).toBe('search');
    expect(decodeToolId('search')).toEqual({ name: 'search' });
    expect(encodeToolId('search', 'fc1')).toBe('fc1::search');
    expect(decodeToolId('fc1::search')).toEqual({ id: 'fc1', name: 'search' });
  });
});

describe('GoogleProvider — history shaping', () => {
  const provider = new GoogleProvider('key', fakeAi({}));

  it('ingestHistory maps assistant → model role with a text part', () => {
    const h = provider.ingestHistory([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'yo' },
    ]);
    expect(h).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'yo' }] },
    ]);
  });

  it('toolResultMessage builds functionResponse parts, decoding the id::name', () => {
    const msg = provider.toolResultMessage([
      { toolUseId: 'fc1::search', content: 'ok', isError: false },
      { toolUseId: 'lookup', content: 'boom', isError: true },
    ]);
    expect(msg).toEqual({
      role: 'user',
      parts: [
        { functionResponse: { id: 'fc1', name: 'search', response: { result: 'ok' } } },
        { functionResponse: { name: 'lookup', response: { error: 'boom' } } },
      ],
    });
  });
});

describe('GoogleProvider — runTurn (injected stream)', () => {
  it('accumulates text + a function call, and maps stop/usage', async () => {
    const provider = new GoogleProvider('key', fakeAi({
      streamChunks: [
        { text: 'Hel' },
        { text: 'lo' },
        { functionCalls: [{ id: 'fc1', name: 'search', args: { q: 'hi' } }] },
        { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } },
      ],
    }));

    const deltas: string[] = [];
    const toolStarts: string[] = [];
    const res = await provider.runTurn(
      {
        model: 'gemini-2.5-pro',
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
    expect(res.toolCalls).toEqual([{ id: 'fc1::search', name: 'search', input: { q: 'hi' } }]);
    expect(toolStarts).toEqual(['search']);
    expect(res.stopReason).toBe('tool_use');
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 });
    expect(res.citations).toEqual([]);
  });

  it('a plain text turn stops with "end"', async () => {
    const provider = new GoogleProvider('key', fakeAi({
      streamChunks: [{ text: 'done' }, { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } }],
    }));
    const res = await provider.runTurn(
      { model: 'gemini-2.5-flash', system: 's', history: [], tools: [], web: { enabled: false }, maxTokens: 100 },
      {},
    );
    expect(res.text).toBe('done');
    expect(res.toolCalls).toEqual([]);
    expect(res.stopReason).toBe('end');
  });
});

describe('GoogleProvider — complete (non-streaming)', () => {
  it('returns text + usage', async () => {
    const provider = new GoogleProvider('key', fakeAi({
      response: { text: 'the answer', usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } },
    }));
    const res = await provider.complete({ model: 'gemini-2.5-pro', messages: [{ role: 'user', content: 'q' }], maxTokens: 100 });
    expect(res.text).toBe('the answer');
    expect(res.usage.inputTokens).toBe(4);
    expect(res.usage.outputTokens).toBe(2);
  });
});
