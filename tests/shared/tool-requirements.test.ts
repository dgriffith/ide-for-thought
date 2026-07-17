import { describe, it, expect } from 'vitest';
import { toolRequiresNote, toolRequiresSelection } from '../../src/shared/tools/types';
import type { ContextRequirement } from '../../src/shared/tools/types';

/** Minimal shape the helpers Pick from. */
function tool(o: { context?: ContextRequirement[]; requiresSelection?: boolean; requiresNote?: boolean }) {
  return { context: o.context ?? [], requiresSelection: o.requiresSelection, requiresNote: o.requiresNote };
}

describe('toolRequiresNote', () => {
  it('is false for whole-thoughtbase tools with no context', () => {
    expect(toolRequiresNote(tool({ context: [] }))).toBe(false);
  });

  it('is true when the context reads the note', () => {
    expect(toolRequiresNote(tool({ context: ['fullNote'] }))).toBe(true);
    expect(toolRequiresNote(tool({ context: ['selectedText'] }))).toBe(true);
    expect(toolRequiresNote(tool({ context: ['claimUnderCursor'] }))).toBe(true);
  });

  it('is false for source-only context (source tools are note-independent)', () => {
    expect(toolRequiresNote(tool({ context: ['sourceMetadata', 'sourceBody'] }))).toBe(false);
  });

  it('is true when a selection is required (selection ⇒ note)', () => {
    expect(toolRequiresNote(tool({ context: [], requiresSelection: true }))).toBe(true);
  });

  it('lets an explicit requiresNote:false override the fullNote derivation', () => {
    // The create-learning-journey case: reads the note when present, but stays
    // invokable with none.
    expect(toolRequiresNote(tool({ context: ['fullNote'], requiresNote: false }))).toBe(false);
  });

  it('lets an explicit requiresNote:true override an empty context', () => {
    expect(toolRequiresNote(tool({ context: [], requiresNote: true }))).toBe(true);
  });
});

describe('toolRequiresSelection', () => {
  it('mirrors requiresSelection', () => {
    expect(toolRequiresSelection(tool({ requiresSelection: true }))).toBe(true);
    expect(toolRequiresSelection(tool({}))).toBe(false);
  });
});
