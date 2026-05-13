/**
 * propose_sources tool — server-side execution contract.
 *
 * Mirrors propose-notes-tool.test.ts. Two guarantees we lock down:
 *
 *  1. The tool MUST NOT call the ingest pipeline. It only emits a draft
 *     event; the renderer triggers ingest via CONVERSATION_FILE_SOURCE_DRAFT
 *     after the user clicks Approve. (Anything else would side-step the
 *     user-approval gate.)
 *  2. The draft event carries the full bundle (note + sources) so the
 *     renderer can render the inline card and the user can review
 *     exactly what will be ingested.
 */

import { describe, it, expect, vi } from 'vitest';
import { executeNotebaseTool, type ToolContext } from '../../../src/main/llm/tools';
import type { ConversationSourceDraft } from '../../../src/shared/conversation-source-drafts';

const baseCtx: ToolContext = { rootPath: '/tmp/never-touched', conversationId: 'conv-test' };

describe('propose_sources tool execution', () => {
  it('emits a draft and returns success without fetching anything', async () => {
    const onSourceDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_sources',
      {
        note: 'Foundational papers for the project',
        sources: [
          { identifier: '10.1038/s41586-023-06924-6' },
          { identifier: 'arXiv:2301.12345' },
          { url: 'https://example.com/post' },
        ],
      },
      { onSourceDraft },
    );
    expect(out.isError).toBe(false);
    expect(onSourceDraft).toHaveBeenCalledTimes(1);

    const draft = onSourceDraft.mock.calls[0][0] as ConversationSourceDraft;
    expect(draft.draftId).toMatch(/^srcdraft-/);
    expect(draft.conversationId).toBe('conv-test');
    expect(draft.note).toBe('Foundational papers for the project');
    expect(draft.sources).toHaveLength(3);
    expect(draft.sources[0]).toEqual({ identifier: '10.1038/s41586-023-06924-6' });
    expect(draft.sources[1]).toEqual({ identifier: 'arXiv:2301.12345' });
    expect(draft.sources[2]).toEqual({ url: 'https://example.com/post' });
  });

  it('returns a "do not repeat inline" hint to the model', async () => {
    const onSourceDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_sources',
      {
        note: 'x',
        sources: [{ identifier: '10.1038/abc' }],
      },
      { onSourceDraft },
    );
    expect(out.isError).toBe(false);
    const parsed = JSON.parse(out.content.split('\n\n')[0]) as { status: string; hint: string };
    expect(parsed.status).toBe('drafted');
    expect(parsed.hint).toMatch(/do not repeat/i);
  });

  it('errors when invoked without an onSourceDraft callback (no UI surface)', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_sources',
      {
        note: 'x',
        sources: [{ identifier: '10.1038/abc' }],
      },
      // no callbacks
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/conversation/i);
  });

  it('errors when the toolContext lacks a conversationId', async () => {
    const out = await executeNotebaseTool(
      { rootPath: '/tmp/whatever' },
      'propose_sources',
      { note: 'x', sources: [{ identifier: '10.1038/abc' }] },
      { onSourceDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/conversation id/i);
  });

  it('rejects an empty sources array', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_sources',
      { note: 'x', sources: [] },
      { onSourceDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/non-empty array/i);
  });

  it('rejects a source entry with both identifier and url set', async () => {
    const onSourceDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_sources',
      {
        note: 'x',
        sources: [{ identifier: '10.1038/abc', url: 'https://example.com/' }],
      },
      { onSourceDraft },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/exactly one of/i);
    expect(onSourceDraft).not.toHaveBeenCalled();
  });

  it('rejects a source entry with neither identifier nor url set', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_sources',
      { note: 'x', sources: [{}] },
      { onSourceDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/exactly one of/i);
  });

  it('rejects an unrecognised identifier', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_sources',
      { note: 'x', sources: [{ identifier: 'not-a-real-id' }] },
      { onSourceDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/Not a recognised/i);
  });

  it('rejects a malformed URL', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_sources',
      { note: 'x', sources: [{ url: 'not a url' }] },
      { onSourceDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/Not a valid http/i);
  });

  it('accepts the common prefix-tolerant identifier forms', async () => {
    const onSourceDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_sources',
      {
        note: 'x',
        sources: [
          { identifier: 'doi:10.1038/abc' },
          { identifier: 'https://doi.org/10.1038/abc' },
          { identifier: 'arXiv:2301.12345' },
          { identifier: 'pmid:12345678' },
        ],
      },
      { onSourceDraft },
    );
    expect(out.isError).toBe(false);
    expect(onSourceDraft).toHaveBeenCalledTimes(1);
    const draft = onSourceDraft.mock.calls[0][0] as ConversationSourceDraft;
    expect(draft.sources).toHaveLength(4);
  });
});
