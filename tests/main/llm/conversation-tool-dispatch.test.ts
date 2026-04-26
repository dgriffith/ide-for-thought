/**
 * Integration coverage for the conversation tool-dispatch loop (#342).
 *
 * Targets `completeWithTools()` in `src/main/llm/index.ts`. Mocks the
 * Anthropic SDK at the client boundary so the orchestrator's loop —
 * stream → finalMessage → handle tool_use → executeNotebaseTool →
 * append tool_result → re-stream — runs for real against a real
 * notebase. The unit tests in `tests/main/tools/` only cover the
 * payload builder; the dispatch loop itself was previously uncovered.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type Anthropic from '@anthropic-ai/sdk';

const { streamMock, getSettingsMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  getSettingsMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { stream: streamMock },
    })),
  };
});

vi.mock('../../../src/main/llm/settings', () => ({ getSettings: getSettingsMock }));

import { completeWithTools } from '../../../src/main/llm/index';

/** Mint a stream-shaped object that resolves to `message` on finalMessage(). */
function streamReturning(message: Anthropic.Message): unknown {
  return {
    on: () => undefined,
    finalMessage: async () => message,
  };
}

/**
 * Captures a deep snapshot of each stream() invocation's messages array.
 * The orchestrator pushes onto its `messages` reference between calls, so
 * `streamMock.mock.calls` would otherwise show the *final* state of the
 * array on every entry.
 */
function setupStreamWith(responses: Anthropic.Message[]): Anthropic.MessageParam[][] {
  const snapshots: Anthropic.MessageParam[][] = [];
  let i = 0;
  streamMock.mockImplementation((args: { messages: Anthropic.MessageParam[] }) => {
    snapshots.push(JSON.parse(JSON.stringify(args.messages)));
    const response = responses[Math.min(i, responses.length - 1)];
    i++;
    return streamReturning(response);
  });
  return snapshots;
}

function textMessage(text: string): Anthropic.Message {
  return {
    id: 'msg-text',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } as unknown as Anthropic.Usage,
    content: [{ type: 'text', text, citations: null }],
  } as unknown as Anthropic.Message;
}

function toolUseMessage(name: string, input: unknown, id: string): Anthropic.Message {
  return {
    id: 'msg-tool',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } as unknown as Anthropic.Usage,
    content: [
      { type: 'tool_use', id, name, input },
    ],
  } as unknown as Anthropic.Message;
}

describe('completeWithTools() dispatch loop (#342)', () => {
  let root: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-conv-dispatch-'));
    streamMock.mockReset();
    getSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue({
      apiKey: 'fake',
      model: 'claude-sonnet-4-6',
      web: { enabled: false, allowedDomains: [], blockedDomains: [] },
    });
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('runs a real notebase tool and feeds the result into the next iteration', async () => {
    // Plant a note for read_note to actually read.
    const notePath = 'notes/hello.md';
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, notePath), '# Hello\nFile body.\n', 'utf-8');

    const snapshots = setupStreamWith([
      toolUseMessage('read_note', { relative_path: notePath }, 'tu-1'),
      textMessage('Final answer.'),
    ]);

    const result = await completeWithTools({
      system: 'sys',
      messages: [{ role: 'user', content: 'read it' }],
      toolContext: { rootPath: root },
    });

    expect(result.text).toBe('Final answer.');
    expect(streamMock).toHaveBeenCalledTimes(2);

    // Iteration 2 must include the assistant's tool_use turn AND the
    // user-role tool_result with the actual file body the notebase produced.
    const secondMessages = snapshots[1];
    expect(secondMessages).toHaveLength(3); // user → assistant(tool_use) → user(tool_result)
    const last = secondMessages[2];
    expect(last.role).toBe('user');
    const blocks = last.content as Anthropic.ToolResultBlockParam[];
    expect(blocks[0].type).toBe('tool_result');
    expect(blocks[0].tool_use_id).toBe('tu-1');
    expect(blocks[0].content).toContain('# Hello');
    expect(blocks[0].is_error).toBeUndefined();
  });

  it('marks tool errors with is_error so the model can recover', async () => {
    const snapshots = setupStreamWith([
      toolUseMessage('read_note', { relative_path: 'does/not/exist.md' }, 'tu-err'),
      textMessage('Sorry.'),
    ]);

    await completeWithTools({
      system: 'sys',
      messages: [{ role: 'user', content: 'read missing' }],
      toolContext: { rootPath: root },
    });

    const secondMessages = snapshots[1];
    const last = secondMessages[2];
    const blocks = last.content as Anthropic.ToolResultBlockParam[];
    expect(blocks[0].is_error).toBe(true);
    expect(String(blocks[0].content)).toMatch(/failed|not found|exist/i);
  });

  it('breaks the loop on non-tool_use stop_reason without a third call', async () => {
    streamMock.mockReturnValueOnce(streamReturning(textMessage('Just text, no tools.')));

    const result = await completeWithTools({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      toolContext: { rootPath: root },
    });
    expect(result.text).toBe('Just text, no tools.');
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it('respects the model override over the global default', async () => {
    streamMock.mockReturnValueOnce(streamReturning(textMessage('done')));

    await completeWithTools({
      system: 'sys',
      messages: [{ role: 'user', content: 'go' }],
      toolContext: { rootPath: root },
      model: 'claude-opus-4-7',
    });
    const args = streamMock.mock.calls[0][0] as { model: string };
    expect(args.model).toBe('claude-opus-4-7');
  });

  it('honours maxIterations as a hard cap on tool-use cycles', async () => {
    // Always return tool_use — the loop should break at maxIterations
    // without ever emitting a final text response.
    streamMock.mockImplementation(() =>
      streamReturning(toolUseMessage('read_note', { relative_path: 'x.md' }, 'tu')),
    );

    const result = await completeWithTools({
      system: 'sys',
      messages: [{ role: 'user', content: 'go' }],
      toolContext: { rootPath: root },
      maxIterations: 3,
    });
    expect(streamMock).toHaveBeenCalledTimes(3);
    expect(result.text).toBe('');
  });
});
