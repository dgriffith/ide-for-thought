/**
 * What a skill's output says when the model ran out of room (#1811).
 *
 * A one-shot skill's output usually becomes a note — the panel offers "Save as
 * Note" the moment it lands. Truncation used to be invisible all the way down:
 * `max_tokens` mapped to the same stop reason as a finished sentence, so an
 * answer cut off mid-word was filed as though it were the whole thing. The
 * marker is the only signal the user gets, and it has to survive into the text
 * that becomes the note, not just a console line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CompleteOptions } from '../../../src/main/llm/index';
import type { ThinkingToolDef } from '../../../src/shared/tools/types';

const h = vi.hoisted(() => ({ complete: vi.fn(), getSettings: vi.fn() }));

vi.mock('../../../src/main/llm/index', () => ({ complete: h.complete }));
vi.mock('../../../src/main/llm/settings', () => ({ getSettings: h.getSettings }));

import { executeTool } from '../../../src/main/tools/executor';
import { registerTool, unregisterTool } from '../../../src/shared/tools/registry';

const TOOL: ThinkingToolDef = {
  id: 'analysis.antithesize',
  name: 'Antithesize',
  category: 'analysis',
  description: '',
  longDescription: '',
  context: ['fullNote'],
  outputMode: 'newNote',
  buildPrompt: () => 'Argue the other side.',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.getSettings.mockResolvedValue({ model: 'claude-opus-5', toolModelOverrides: {} });
  registerTool(TOOL);
});

afterEach(() => unregisterTool(TOOL.id));

describe('executeTool truncation marker', () => {
  it('marks output that stopped at the token cap as incomplete', async () => {
    h.complete.mockImplementation(async (_prompt: string, opts: CompleteOptions) => {
      opts.onTruncated?.();
      return 'The strongest counter-argument is that the premi';
    });

    const result = await executeTool({ toolId: TOOL.id, context: {} });

    expect(result.output).toContain('The strongest counter-argument is that the premi');
    expect(result.output).toContain('length limit');
  });

  it('leaves a complete answer exactly as the model wrote it', async () => {
    h.complete.mockResolvedValue('A finished essay.');

    const result = await executeTool({ toolId: TOOL.id, context: {} });

    expect(result.output).toBe('A finished essay.');
  });
});
