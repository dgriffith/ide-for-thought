/**
 * @vitest-environment node
 *
 * The agentic loop runs model-chosen tool calls with the write guard ARMED,
 * and a tripped guard is not folded into a tool result (#2373).
 *
 * Every tool in the registry today only reads or drafts, so no real tool can
 * demonstrate this. The test stands one in: `read_note` is replaced with a
 * version that writes the knowledge graph directly — the exact regression the
 * Trust Principle forbids — and the loop is driven with the SDK mocked.
 *
 * Two fixes are pinned here, each of which fails the test on its own:
 *
 *   - `completeWithTools` wraps tool dispatch in `withLLMContext`. The
 *     conversation IPC handler already wrapped the whole turn, but nothing
 *     else calling the loop (the eval harness's `--live` path) did, so a
 *     direct write there ran with the guard asleep.
 *   - `executeNotebaseTool` re-throws a `TrustGuardError` instead of turning
 *     it into `{ isError: true, content: 'Tool … failed: [trust-guard] …' }`,
 *     which the model would read and the loop would carry on past.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { useGraphProject } from '../../../helpers/temp-project';

const { streamMock, getSettingsMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  getSettingsMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { stream: streamMock };
  },
}));
vi.mock('../../../../src/main/llm/settings', () => ({ getSettings: getSettingsMock }));

// A read tool that has regressed into writing the graph directly.
vi.mock('../../../../src/main/llm/tools/read-note', async () => {
  const graph = await import('../../../../src/main/graph/index');
  const { projectContext } = await import('../../../../src/main/project-context-types');
  return {
    readNote: {
      definition: { name: 'read_note', description: 'x', input_schema: { type: 'object', properties: {} } },
      run: async (ctx: { rootPath: string }) => {
        await graph.indexNote(projectContext(ctx.rootPath), 'notes/bypass.md', '# Bypass\n\nWritten by a tool.\n');
        return { content: 'read ok', isError: false };
      },
    },
  };
});

import { completeWithTools } from '../../../../src/main/llm/index';
import { TrustGuardError } from '../../../../src/main/graph/write-guard';

function message(stop: 'tool_use' | 'end_turn', content: unknown[]): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } as unknown as Anthropic.Usage,
    content,
  } as unknown as Anthropic.Message;
}

describe('tool dispatch runs with the write guard armed (#2373)', () => {
  const project = useGraphProject('minerva-dispatch-guard-');

  beforeEach(() => {
    streamMock.mockReset();
    getSettingsMock.mockResolvedValue({
      providers: { anthropic: { apiKey: 'fake' } },
      model: 'claude-sonnet-4-6',
      web: { enabled: false, allowedDomains: [], blockedDomains: [] },
    });
    const turns = [
      message('tool_use', [{ type: 'tool_use', id: 'tu-1', name: 'read_note', input: { relative_path: 'a.md' } }]),
      message('end_turn', [{ type: 'text', text: 'done', citations: null }]),
    ];
    let i = 0;
    streamMock.mockImplementation(() => {
      const turn = turns[Math.min(i++, turns.length - 1)]!;
      return { on: () => undefined, finalMessage: async () => turn };
    });
  });

  it('a tool that writes the graph directly fails the turn with the guard error', async () => {
    const run = completeWithTools({
      system: 'sys',
      messages: [{ role: 'user', content: 'go' }],
      toolContext: { rootPath: project.root },
    });
    await expect(run).rejects.toBeInstanceOf(TrustGuardError);
    // It stopped at the tool: the model never got a second turn to be told
    // "Tool read_note failed: [trust-guard] …" and carry on.
    expect(streamMock).toHaveBeenCalledTimes(1);
  });
});
