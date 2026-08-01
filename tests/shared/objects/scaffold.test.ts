/**
 * Typed-note scaffold builder (#1064): `type:` frontmatter + declared property
 * keys + template body.
 */
import { describe, it, expect } from 'vitest';
import { buildTypedNoteScaffold } from '../../../src/shared/objects/scaffold';
import type { TypeInfo } from '../../../src/shared/objects/type-def';

const book: TypeInfo = {
  id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock',
  properties: [{ name: 'author', type: 'text' }, { name: 'rating', type: 'number' }],
};

describe('buildTypedNoteScaffold (#1064)', () => {
  it('emits type: + a key per declared property, then the body', () => {
    const { content, caretOffset } = buildTypedNoteScaffold(book, '## Summary\n');
    expect(content).toBe('---\ntype: book\nauthor:\nrating:\n---\n\n## Summary\n');
    // Caret lands past the frontmatter.
    expect(content.slice(caretOffset)).toMatch(/^\n?## Summary/);
  });

  it('handles a type with no template (scaffold only)', () => {
    const { content } = buildTypedNoteScaffold(book, '');
    expect(content).toBe('---\ntype: book\nauthor:\nrating:\n---\n');
  });

  it('handles a type with no declared properties', () => {
    const bare: TypeInfo = { id: 'idea', label: 'Idea', classLocalName: 'Idea', source: 'stock', properties: [] };
    expect(buildTypedNoteScaffold(bare, '')).toMatchObject({ content: '---\ntype: idea\n---\n' });
  });
});
