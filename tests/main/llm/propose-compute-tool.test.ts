/**
 * propose_compute tool — server-side execution contract (#1935).
 *
 * Trust-principle parity with the other propose_* tools: the tool never
 * executes the cell. It validates the input, runs the static red-flag scan
 * (`scanComputeSafety`), and emits a ConversationComputeDraft for inline
 * review — the user clicks Run/Insert/Discard.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeNotebaseTool, NOTEBASE_TOOLS, type ToolContext } from '../../../src/main/llm/tools';
import type { ConversationComputeDraft } from '../../../src/shared/conversation-compute-drafts';

const baseCtx: ToolContext = { rootPath: '/tmp/never-touched', conversationId: 'conv-test' };

describe('propose_compute tool execution', () => {
  it('emits a compute draft with no safety flags for benign SPARQL', async () => {
    const onComputeDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_compute',
      { language: 'sparql', code: 'SELECT ?n WHERE { ?n a minerva:Note }', rationale: 'count notes' },
      { onComputeDraft },
    );
    expect(out.isError).toBe(false);
    expect(onComputeDraft).toHaveBeenCalledTimes(1);

    const draft = onComputeDraft.mock.calls[0][0] as ConversationComputeDraft;
    expect(draft.draftId).toMatch(/^cmpdraft-/);
    expect(draft.conversationId).toBe('conv-test');
    expect(draft.language).toBe('sparql');
    expect(draft.code).toBe('SELECT ?n WHERE { ?n a minerva:Note }');
    expect(draft.rationale).toBe('count notes');
    expect(draft.safetyFlags).toEqual([]);

    const parsed = JSON.parse(out.content.split('\n\n')[0]) as { status: string; language: string; safetyFlags: string[] };
    expect(parsed.status).toBe('drafted');
    expect(parsed.language).toBe('sparql');
    expect(parsed.safetyFlags).toEqual([]);
    expect(out.content).toContain('(queued sparql draft)');
  });

  it('surfaces red-flag scan hits for a risky python cell', async () => {
    const onComputeDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_compute',
      { language: 'python', code: 'import subprocess\nsubprocess.run(["ls"])', rationale: 'list files' },
      { onComputeDraft },
    );
    expect(out.isError).toBe(false);
    const draft = onComputeDraft.mock.calls[0][0] as ConversationComputeDraft;
    expect(draft.safetyFlags.length).toBeGreaterThan(0);
  });

  it('surfaces red-flag scan hits for a risky sql cell', async () => {
    const onComputeDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_compute',
      { language: 'sql', code: "COPY tbl TO 'out.csv'", rationale: 'export' },
      { onComputeDraft },
    );
    expect(out.isError).toBe(false);
    const draft = onComputeDraft.mock.calls[0][0] as ConversationComputeDraft;
    expect(draft.safetyFlags.map((f) => f.id)).toContain('sql-copy-to');
  });

  it('errors when invoked without an onComputeDraft callback (no UI surface)', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_compute',
      { language: 'sql', code: 'SELECT 1', rationale: 'x' },
      // no callbacks
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/only available in conversation contexts/);
  });

  it('errors when the toolContext lacks a conversationId', async () => {
    const out = await executeNotebaseTool(
      { rootPath: '/tmp/whatever' },
      'propose_compute',
      { language: 'sql', code: 'SELECT 1', rationale: 'x' },
      { onComputeDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/bound conversation id/);
  });

  it('rejects an unsupported language', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_compute',
      { language: 'javascript', code: 'console.log(1)', rationale: 'x' },
      { onComputeDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/must be one of "sparql", "sql", "python"/);
  });

  it('rejects blank code', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_compute',
      { language: 'sql', code: '   ', rationale: 'x' },
      { onComputeDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/`code` is required/);
  });

  it('rejects a blank rationale', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_compute',
      { language: 'sql', code: 'SELECT 1', rationale: '  ' },
      { onComputeDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/`rationale` is required/);
  });

  it('rejects a non-object input', async () => {
    const out = await executeNotebaseTool(baseCtx, 'propose_compute', 'not an object', { onComputeDraft: vi.fn() });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/must be an object/);
  });

  it('is registered in the default conversation toolset', () => {
    expect(NOTEBASE_TOOLS.map((t) => t.name)).toContain('propose_compute');
  });
});
