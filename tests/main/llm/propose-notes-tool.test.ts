/**
 * propose_notes tool — server-side execution contract.
 *
 * Two non-negotiable guarantees we lock down here:
 *
 *  1. The tool MUST NOT call proposeWrite. It only emits a draft event;
 *     the renderer files via CONVERSATION_FILE_DRAFT after the user
 *     clicks Approve. (Any direct file would violate the trust principle.)
 *
 *  2. The draft event carries the full bundle (note + payloads) so the
 *     renderer can preview without a server round-trip and so apply
 *     happens after the user has reviewed exactly what'll land.
 *
 * The IPC handler that the renderer hits (CONVERSATION_FILE_DRAFT) is
 * exercised end-to-end in tests/main/llm/conversation-drafts-flow.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { executeNotebaseTool, type ToolContext } from '../../../src/main/llm/tools';
import type { ConversationDraft } from '../../../src/shared/conversation-drafts';

const baseCtx: ToolContext = { rootPath: '/tmp/never-touched', conversationId: 'conv-test' };

describe('propose_notes tool execution', () => {
  it('emits a draft and returns success without filing anything', async () => {
    const onDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_notes',
      {
        note: 'Filed for review',
        payloads: [
          { kind: 'note', relativePath: 'notes/a.md', content: '# A\n' },
          { kind: 'note', relativePath: 'notes/b.md', content: '# B\n' },
        ],
      },
      { onDraft },
    );
    expect(out.isError).toBe(false);
    expect(onDraft).toHaveBeenCalledTimes(1);

    const draft = onDraft.mock.calls[0][0] as ConversationDraft;
    expect(draft.draftId).toMatch(/^draft-/);
    expect(draft.conversationId).toBe('conv-test');
    expect(draft.note).toBe('Filed for review');
    expect(draft.payloads).toHaveLength(2);
    expect(draft.payloads[0]).toEqual({ kind: 'note', relativePath: 'notes/a.md', content: '# A\n' });
  });

  it('returns the draft id and a "do not repeat inline" hint to the model', async () => {
    const onDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_notes',
      {
        note: 'x',
        payloads: [{ kind: 'note', relativePath: 'notes/y.md', content: '# y\n' }],
      },
      { onDraft },
    );
    expect(out.isError).toBe(false);
    const parsed = JSON.parse(out.content.split('\n\n')[0]) as { status: string; hint: string };
    expect(parsed.status).toBe('drafted');
    expect(parsed.hint).toMatch(/do not repeat/i);
  });

  it('errors when invoked without an onDraft callback (no UI surface)', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_notes',
      {
        note: 'x',
        payloads: [{ kind: 'note', relativePath: 'notes/y.md', content: 'y' }],
      },
      // no callbacks
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/conversation/i);
  });

  it('errors when the toolContext lacks a conversationId', async () => {
    const out = await executeNotebaseTool(
      { rootPath: '/tmp/whatever' },
      'propose_notes',
      {
        note: 'x',
        payloads: [{ kind: 'note', relativePath: 'notes/y.md', content: 'y' }],
      },
      { onDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/conversation id/i);
  });

  it('rejects a payload whose relativePath escapes the project root', async () => {
    const onDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_notes',
      {
        note: 'x',
        payloads: [{ kind: 'note', relativePath: '../etc/passwd', content: 'nope' }],
      },
      { onDraft },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/unsafe/i);
    expect(onDraft).not.toHaveBeenCalled();
  });

  it('rejects an unsupported payload kind', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_notes',
      {
        note: 'x',
        payloads: [{ kind: 'graph-triples', turtle: '<x> a <Y> .', affectsNodeUris: [] }],
      },
      { onDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/unsupported payload kind/i);
  });

  it('rejects an empty payloads array', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_notes',
      { note: 'x', payloads: [] },
      { onDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/non-empty array/i);
  });
});
