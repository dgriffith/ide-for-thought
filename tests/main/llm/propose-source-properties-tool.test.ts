/**
 * propose_source_properties tool (#103) — server-side execution contract.
 *
 * Mirrors propose-sources-tool.test.ts. Guarantees:
 *  1. The tool MUST NOT write the source. It only emits a draft; the renderer
 *     triggers the meta.ttl upsert via CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT
 *     after Approve — the trust-principle gate.
 *  2. The draft carries the sourceId + proposed abstract/tldr for review.
 *  3. Validation rejects empty bundles (no abstract and no tldr).
 */
import { describe, it, expect, vi } from 'vitest';
import { executeNotebaseTool, type ToolContext } from '../../../src/main/llm/tools';
import type { ConversationSourcePropertyDraft } from '../../../src/shared/conversation-source-property-drafts';

const baseCtx: ToolContext = { rootPath: '/tmp/never-touched', conversationId: 'conv-test' };

describe('propose_source_properties tool execution', () => {
  it('emits a draft with the proposed abstract + tldr, writing nothing', async () => {
    const onSourcePropertyDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_source_properties',
      {
        note: 'Summary of the Smith paper',
        sourceId: 'src-smith-2024',
        abstract: 'A formal abstract.',
        tldr: 'The plain-language gist.',
      },
      { onSourcePropertyDraft },
    );
    expect(out.isError).toBe(false);
    expect(onSourcePropertyDraft).toHaveBeenCalledTimes(1);

    const draft = onSourcePropertyDraft.mock.calls[0][0] as ConversationSourcePropertyDraft;
    expect(draft.draftId).toMatch(/^srcpropdraft-/);
    expect(draft.conversationId).toBe('conv-test');
    expect(draft.sourceId).toBe('src-smith-2024');
    expect(draft.abstract).toBe('A formal abstract.');
    expect(draft.tldr).toBe('The plain-language gist.');
  });

  it('accepts a tldr-only proposal', async () => {
    const onSourcePropertyDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_source_properties',
      { note: 'n', sourceId: 's', tldr: 'just a tldr' },
      { onSourcePropertyDraft },
    );
    expect(out.isError).toBe(false);
    const draft = onSourcePropertyDraft.mock.calls[0][0] as ConversationSourcePropertyDraft;
    expect(draft.abstract).toBeUndefined();
    expect(draft.tldr).toBe('just a tldr');
  });

  it('rejects a proposal with neither abstract nor tldr', async () => {
    const onSourcePropertyDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_source_properties',
      { note: 'n', sourceId: 's' },
      { onSourcePropertyDraft },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('at least one');
    expect(onSourcePropertyDraft).not.toHaveBeenCalled();
  });

  it('rejects a missing sourceId', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_source_properties',
      { note: 'n', abstract: 'a' },
      { onSourcePropertyDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('sourceId');
  });

  it('errors with a clear message when no UI surface is wired', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_source_properties',
      { note: 'n', sourceId: 's', abstract: 'a' },
      {}, // no onSourcePropertyDraft
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('only available in conversation contexts');
  });

  it('returns a "do not repeat inline" hint to the model', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'propose_source_properties',
      { note: 'n', sourceId: 's', abstract: 'a' },
      { onSourcePropertyDraft: vi.fn() },
    );
    expect(out.content).toContain('STOP');
    expect(out.content).toContain('queued source-property draft');
  });
});
