/**
 * ask_user tool (#1935) — template-scoped: NOT in the default conversation
 * toolset (only opted into by templates via `requiresTools: ['ask_user']`),
 * but dispatchable by name via `executeNotebaseTool` regardless.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeNotebaseTool, NOTEBASE_TOOLS, type ToolContext } from '../../../src/main/llm/tools';

const baseCtx: ToolContext = { rootPath: '/tmp/never-touched' };

describe('ask_user tool execution', () => {
  it('round-trips the question and choices to the callback and returns its reply', async () => {
    const askUser = vi.fn().mockResolvedValue('yes');
    const out = await executeNotebaseTool(
      baseCtx,
      'ask_user',
      { question: 'Proceed?', choices: ['yes', 'no'] },
      { askUser },
    );
    expect(out.isError).toBe(false);
    expect(out.content).toBe('yes');
    expect(askUser).toHaveBeenCalledWith({ question: 'Proceed?', choices: ['yes', 'no'] });
  });

  it('trims the question and drops blank choice entries', async () => {
    const askUser = vi.fn().mockResolvedValue('ok');
    await executeNotebaseTool(
      baseCtx,
      'ask_user',
      { question: '  Proceed?  ', choices: ['  a  ', '   ', 'b'] },
      { askUser },
    );
    expect(askUser).toHaveBeenCalledWith({ question: 'Proceed?', choices: ['a', 'b'] });
  });

  it('omits choices when every entry is blank', async () => {
    const askUser = vi.fn().mockResolvedValue('ok');
    await executeNotebaseTool(baseCtx, 'ask_user', { question: 'Proceed?', choices: ['  ', ''] }, { askUser });
    expect(askUser).toHaveBeenCalledWith({ question: 'Proceed?', choices: undefined });
  });

  it('omits choices when not provided', async () => {
    const askUser = vi.fn().mockResolvedValue('ok');
    await executeNotebaseTool(baseCtx, 'ask_user', { question: 'Proceed?' }, { askUser });
    expect(askUser).toHaveBeenCalledWith({ question: 'Proceed?', choices: undefined });
  });

  it('errors when invoked without an askUser callback (no UI surface)', async () => {
    const out = await executeNotebaseTool(baseCtx, 'ask_user', { question: 'Proceed?' });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/no UI to render the question/);
  });

  it('rejects a non-object input', async () => {
    const out = await executeNotebaseTool(baseCtx, 'ask_user', null, { askUser: vi.fn() });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/must be an object/);
  });

  it('rejects a missing/blank question', async () => {
    const out = await executeNotebaseTool(baseCtx, 'ask_user', { question: '  ' }, { askUser: vi.fn() });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/non-empty `question`/);
  });

  it('is template-scoped: NOT in the default conversation toolset', () => {
    expect(NOTEBASE_TOOLS.map((t) => t.name)).not.toContain('ask_user');
  });
});
