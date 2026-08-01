/**
 * Type-keyed card field selection (#1071): the type's `card:` template drives
 * which property chips show (user-overridable), defaulting to the first few
 * declared properties; the cover property is pulled out for the image and never
 * doubled as a chip.
 */
import { describe, it, expect } from 'vitest';
import { selectCardFields, DEFAULT_CARD_FIELD_COUNT } from '../../../src/shared/objects/card';
import type { NoteTypedProperties, TypeInfo } from '../../../src/shared/objects/type-def';

function typed(over: Partial<TypeInfo>, values: Record<string, string | null>): NoteTypedProperties {
  const type: TypeInfo = {
    id: 'book',
    label: 'Book',
    classLocalName: 'Book',
    source: 'stock',
    properties: [
      { name: 'cover', type: 'text', label: 'Cover' },
      { name: 'author', type: 'text', label: 'Author' },
      { name: 'rating', type: 'number', label: 'Rating' },
      { name: 'status', type: 'text', label: 'Status' },
      { name: 'isbn', type: 'text', label: 'ISBN' },
    ],
    ...over,
  };
  return {
    type,
    properties: type.properties.map((p) => ({ ...p, value: values[p.name] ?? null })),
  };
}

describe('selectCardFields (#1071)', () => {
  it('returns empty for an untyped note', () => {
    expect(selectCardFields({ type: null, properties: [] })).toEqual({ fields: [], cover: null });
  });

  it('pulls the cover value out and shows the default number of other fields', () => {
    const rb = typed(
      { cover: 'cover' },
      { cover: 'https://x/c.png', author: 'Herbert', rating: '5', status: 'read', isbn: '123' },
    );
    const card = selectCardFields(rb);
    expect(card.cover).toBe('https://x/c.png');
    expect(card.fields).toHaveLength(DEFAULT_CARD_FIELD_COUNT);
    expect(card.fields.map((f) => f.name)).not.toContain('cover'); // cover is the image, not a chip
    expect(card.fields.map((f) => f.name)).toEqual(['author', 'rating', 'status']);
  });

  it('honors an explicit card: template (the user override)', () => {
    const rb = typed(
      { cover: 'cover', card: ['rating', 'author'] },
      { cover: 'https://x/c.png', author: 'Gibson', rating: '4' },
    );
    const card = selectCardFields(rb);
    expect(card.fields.map((f) => f.name)).toEqual(['rating', 'author']); // order + selection respected
    expect(card.cover).toBe('https://x/c.png');
  });

  it('carries the property label + value onto each field', () => {
    const rb = typed({ card: ['author'] }, { author: 'Le Guin' });
    expect(selectCardFields(rb).fields[0]).toEqual({ name: 'author', label: 'Author', value: 'Le Guin' });
  });

  it('has no cover when the type declares none', () => {
    const rb = typed({ card: ['author'] }, { author: 'x' });
    expect(selectCardFields(rb).cover).toBeNull();
  });
});
