/**
 * set_properties tool — server-side execution contract (#1935).
 *
 * Trust-principle parity with propose_notes / propose_compute: this tool
 * MUST NOT write anything. It only emits a ConversationPropertyDraft; the
 * actual frontmatter patch + approval-engine proposal is applied later by
 * `applyPropertyUpdates` (covered separately in set-properties-apply.test.ts)
 * once the user approves the draft card.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeNotebaseTool, NOTEBASE_TOOLS, type ToolContext } from '../../../src/main/llm/tools';
import type { ConversationPropertyDraft } from '../../../src/shared/conversation-property-drafts';

const baseCtx: ToolContext = { rootPath: '/tmp/never-touched', conversationId: 'conv-test' };

describe('set_properties tool execution', () => {
  it('emits a property draft and returns "drafted" without writing anything', async () => {
    const onPropertyDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'set_properties',
      {
        note: 'Mark as done',
        updates: [{ relativePath: 'notes/a.md', properties: { status: 'done' } }],
      },
      { onPropertyDraft },
    );
    expect(out.isError).toBe(false);
    expect(onPropertyDraft).toHaveBeenCalledTimes(1);

    const draft = onPropertyDraft.mock.calls[0][0] as ConversationPropertyDraft;
    expect(draft.draftId).toMatch(/^propdraft-/);
    expect(draft.conversationId).toBe('conv-test');
    expect(draft.note).toBe('Mark as done');
    expect(draft.updates).toEqual([{ relativePath: 'notes/a.md', properties: { status: 'done' } }]);

    const parsed = JSON.parse(out.content.split('\n\n')[0]) as { status: string; updateCount: number; hint: string };
    expect(parsed.status).toBe('drafted');
    expect(parsed.updateCount).toBe(1);
    expect(parsed.hint).toMatch(/do not call set_properties again/i);
    expect(out.content).toContain('queued property draft: notes/a.md (1 key)');
  });

  it('pluralizes the key count in the summary for a multi-key update', async () => {
    const onPropertyDraft = vi.fn();
    const out = await executeNotebaseTool(
      baseCtx,
      'set_properties',
      {
        note: 'x',
        updates: [{ relativePath: 'notes/a.md', properties: { status: 'done', priority: 1 } }],
      },
      { onPropertyDraft },
    );
    expect(out.content).toContain('notes/a.md (2 keys)');
  });

  it('errors when invoked without an onPropertyDraft callback (no UI surface)', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'set_properties',
      { note: 'x', updates: [{ relativePath: 'a.md', properties: { x: 1 } }] },
      // no callbacks
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/only available in conversation contexts/);
  });

  it('errors when the toolContext lacks a conversationId', async () => {
    const out = await executeNotebaseTool(
      { rootPath: '/tmp/whatever' },
      'set_properties',
      { note: 'x', updates: [{ relativePath: 'a.md', properties: { x: 1 } }] },
      { onPropertyDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/bound conversation id/);
  });

  it('rejects a missing/blank note', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'set_properties',
      { note: '  ', updates: [{ relativePath: 'a.md', properties: { x: 1 } }] },
      { onPropertyDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/`note` is required/);
  });

  it('rejects an empty updates array', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'set_properties',
      { note: 'x', updates: [] },
      { onPropertyDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/non-empty array/);
  });

  it('rejects an update missing relativePath', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'set_properties',
      { note: 'x', updates: [{ properties: { x: 1 } }] },
      { onPropertyDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/non-empty `relativePath`/);
  });

  it('rejects a relativePath that escapes the project root', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'set_properties',
      { note: 'x', updates: [{ relativePath: '../etc/passwd', properties: { x: 1 } }] },
      { onPropertyDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/must not contain '\.\.'/);
  });

  it('rejects an update with a non-object properties value', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'set_properties',
      { note: 'x', updates: [{ relativePath: 'a.md', properties: [] }] },
      { onPropertyDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/non-array object/);
  });

  it('rejects an update with an empty properties object', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'set_properties',
      { note: 'x', updates: [{ relativePath: 'a.md', properties: {} }] },
      { onPropertyDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/at least one key/);
  });

  it('rejects a property value that cannot round-trip through YAML', async () => {
    const out = await executeNotebaseTool(
      baseCtx,
      'set_properties',
      { note: 'x', updates: [{ relativePath: 'a.md', properties: { bad: undefined } }] },
      { onPropertyDraft: vi.fn() },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/not a YAML-encodable/);
  });

  it('rejects a non-object input', async () => {
    const out = await executeNotebaseTool(baseCtx, 'set_properties', null, { onPropertyDraft: vi.fn() });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/must be an object/);
  });

  it('is registered in the default conversation toolset', () => {
    expect(NOTEBASE_TOOLS.map((t) => t.name)).toContain('set_properties');
  });
});
