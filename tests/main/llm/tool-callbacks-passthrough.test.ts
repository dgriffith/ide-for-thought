import { describe, it, expect } from 'vitest';
import { toToolCallbacks } from '../../../src/main/llm/index';

/**
 * Regression: the conversation runner projects its `StreamCallbacks` down to the
 * `ToolCallbacks` the tool executor receives. A callback missing from that
 * projection makes its tool report "only available in conversation contexts" —
 * which is exactly what happened to the note-refactor tools (#912/#914): their
 * callbacks were declared on the IPC side but dropped here, so propose_note_rename
 * / move / reorganization all failed inside a real conversation.
 */
describe('toToolCallbacks', () => {
  const noop = () => {};
  const all = {
    onChunk: noop,
    onDraft: noop,
    onSourceDraft: noop,
    onPropertyDraft: noop,
    onSourcePropertyDraft: noop,
    onClaimsDraft: noop,
    onComputeDraft: noop,
    onRefactorDraft: noop,
    onReorgDraft: noop,
    onDeleteDraft: noop,
    onNoteBodyDraft: noop,
    askUser: async () => '',
  };

  it('passes every tool-facing callback through to tool execution', () => {
    const out = toToolCallbacks(all) as Record<string, unknown>;
    for (const key of [
      'onDraft', 'onSourceDraft', 'onPropertyDraft', 'onSourcePropertyDraft',
      'onClaimsDraft', 'onComputeDraft', 'onRefactorDraft', 'onReorgDraft', 'onDeleteDraft', 'onNoteBodyDraft', 'askUser',
    ]) {
      expect(out[key], `${key} must reach the tool executor`).toBe((all as Record<string, unknown>)[key]);
    }
  });

  it('does not leak stream-only callbacks (onChunk) into tool callbacks', () => {
    expect('onChunk' in toToolCallbacks(all)).toBe(false);
  });

  it('omits callbacks that are not set, and handles undefined', () => {
    expect(toToolCallbacks(undefined)).toEqual({});
    const partial = toToolCallbacks({ onChunk: noop, onRefactorDraft: noop });
    expect(partial.onRefactorDraft).toBe(noop);
    expect('onReorgDraft' in partial).toBe(false);
  });
});
