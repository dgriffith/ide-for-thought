import { describe, it, expect } from 'vitest';
import { toToolCallbacks, TOOL_CALLBACK_KEYS } from '../../../src/main/llm/index';

/**
 * Regression + completeness for the StreamCallbacks → ToolCallbacks projection.
 *
 * A callback missing from that projection makes its tool report "only available
 * in conversation contexts" — exactly what happened to the note-refactor tools
 * (#912/#914): their callbacks were declared on the IPC side but dropped here,
 * so propose_note_rename / move / reorganization all failed inside a real
 * conversation.
 *
 * These tests derive from the exported `TOOL_CALLBACK_KEYS` (no hardcoded copy)
 * so they automatically cover any new key. The *completeness* invariant — that
 * `TOOL_CALLBACK_KEYS` names every key of `ToolCallbacks` — is enforced at
 * build time by the compile-time guard co-located with the constant in
 * `src/main/llm/index.ts` (#1003); these runtime tests guard the projection
 * behaviour and keep the constant honest.
 */
describe('toToolCallbacks (#912 / #914 / #1003)', () => {
  const noop = () => {};
  // One stub per tool-facing callback, plus a stream-only callback (onChunk)
  // that must NOT leak into the tool callbacks.
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

  it('passes every tool-facing callback (TOOL_CALLBACK_KEYS) through, and nothing else', () => {
    const out = toToolCallbacks(all) as Record<string, unknown>;
    for (const key of TOOL_CALLBACK_KEYS) {
      expect(out[key], `${key} must reach the tool executor`).toBe((all as Record<string, unknown>)[key]);
    }
    // Exactly the tool-facing keys — nothing less (dropped callback), nothing
    // more (a stream-only callback like onChunk leaking through).
    expect(Object.keys(out).sort()).toEqual([...TOOL_CALLBACK_KEYS].sort());
  });

  it('keeps the sample honest: a stub exists for every TOOL_CALLBACK_KEYS entry', () => {
    for (const key of TOOL_CALLBACK_KEYS) {
      expect(key in all, `add a stub for '${key}' to the test sample`).toBe(true);
    }
  });

  it('lists each callback key exactly once', () => {
    expect(new Set(TOOL_CALLBACK_KEYS).size).toBe(TOOL_CALLBACK_KEYS.length);
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
