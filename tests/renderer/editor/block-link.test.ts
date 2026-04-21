import { describe, it, expect } from 'vitest';
import { planBlockLink } from '../../../src/renderer/lib/editor/block-link';

function fixedId(): string {
  return 'abc123';
}

function applyEdit(content: string, edit: { at: number; text: string }): string {
  return content.slice(0, edit.at) + edit.text + content.slice(edit.at);
}

describe('planBlockLink (#138)', () => {
  it('reuses an existing block-id at the paragraph end', () => {
    const content = 'First paragraph text. ^existing-id\n\nAnother paragraph.\n';
    // Cursor somewhere in the first paragraph.
    const plan = planBlockLink(content, 5, fixedId);
    expect(plan).not.toBeNull();
    expect(plan!.blockId).toBe('existing-id');
    expect(plan!.edit).toBeNull();
  });

  it('proposes inserting a new id when the paragraph has none', () => {
    const content = 'A paragraph without any marker.\n\nAnother.\n';
    const plan = planBlockLink(content, 5, fixedId);
    expect(plan).not.toBeNull();
    expect(plan!.blockId).toBe('abc123');
    expect(plan!.edit).not.toBeNull();
    // The insert should land at the end of the first paragraph's last line.
    const afterEdit = applyEdit(content, plan!.edit!);
    expect(afterEdit).toContain('A paragraph without any marker. ^abc123\n');
  });

  it('expands to the full paragraph even when the click is mid-paragraph', () => {
    const content = [
      'Line one of paragraph.',
      'Line two.',
      'Line three.',
      '',
      'Another paragraph.',
      '',
    ].join('\n');
    // Cursor on "Line two."
    const pos = content.indexOf('Line two.');
    const plan = planBlockLink(content, pos, fixedId);
    expect(plan).not.toBeNull();
    // Insertion should land at the end of "Line three." — the last line of
    // the paragraph that contains the click.
    const afterEdit = applyEdit(content, plan!.edit!);
    expect(afterEdit).toContain('Line three. ^abc123\n');
    expect(afterEdit).not.toContain('Line two. ^abc123');
  });

  it('returns null when the cursor is on a blank line', () => {
    const content = 'Before.\n\n\nAfter.\n';
    const blankPos = content.indexOf('\n\n') + 1; // on a blank line
    expect(planBlockLink(content, blankPos, fixedId)).toBeNull();
  });

  it('handles a paragraph that ends at doc end (no trailing newline)', () => {
    const content = 'Just a paragraph.';
    const plan = planBlockLink(content, 3, fixedId);
    expect(plan).not.toBeNull();
    const afterEdit = applyEdit(content, plan!.edit!);
    expect(afterEdit).toBe('Just a paragraph. ^abc123');
  });

  it('works at doc start (no preceding content)', () => {
    const content = 'First paragraph.\n\nSecond.\n';
    const plan = planBlockLink(content, 0, fixedId);
    expect(plan).not.toBeNull();
    const afterEdit = applyEdit(content, plan!.edit!);
    expect(afterEdit).toContain('First paragraph. ^abc123\n\nSecond.\n');
  });

  it('does not add a leading space when the paragraph already ends with whitespace', () => {
    const content = 'Ends with trailing space. ';
    const plan = planBlockLink(content, 3, fixedId);
    expect(plan).not.toBeNull();
    const afterEdit = applyEdit(content, plan!.edit!);
    expect(afterEdit).toBe('Ends with trailing space. ^abc123');
  });

  it('preserves line-item paragraphs as one block (no blank line between items)', () => {
    const content = '- item one\n- item two\n- item three\n\nparagraph\n';
    const pos = content.indexOf('item two');
    const plan = planBlockLink(content, pos, fixedId);
    expect(plan).not.toBeNull();
    const afterEdit = applyEdit(content, plan!.edit!);
    // Marker goes at the end of the full list-as-paragraph.
    expect(afterEdit).toContain('- item three ^abc123\n');
  });
});
