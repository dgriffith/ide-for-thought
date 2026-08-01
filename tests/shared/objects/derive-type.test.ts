/**
 * Deriving a type from a note's frontmatter ("Save Note as Object Type").
 */
import { describe, it, expect } from 'vitest';
import { inferPropertyType, deriveTypeProperties } from '../../../src/shared/objects/derive-type';

describe('inferPropertyType', () => {
  it('recognises wiki-links, numbers, dates, and falls back to text', () => {
    expect(inferPropertyType('[[Alice]]')).toBe('link-to-type');
    expect(inferPropertyType('42')).toBe('number');
    expect(inferPropertyType('3.14')).toBe('number');
    expect(inferPropertyType('2020-06-01')).toBe('date');
    expect(inferPropertyType('2020-06-01T09:00')).toBe('date');
    expect(inferPropertyType('Frank Herbert')).toBe('text');
    expect(inferPropertyType('9780441172719')).toBe('number'); // long digit run — still numeric
  });
});

describe('deriveTypeProperties', () => {
  it('maps frontmatter keys to declared properties, skipping reserved keys', () => {
    const props = deriveTypeProperties({
      title: 'Dune',            // reserved — skipped
      tags: 'sci-fi',           // reserved — skipped
      type: 'book',             // reserved — skipped
      aliases: 'Dune Messiah',  // reserved — skipped
      author: '[[Frank Herbert]]',
      rating: '5',
      published: '1965-08-01',
      publisher: 'Chilton',
    });
    expect(props.map((p) => p.name)).toEqual(['author', 'rating', 'published', 'publisher']);
    const byName = new Map(props.map((p) => [p.name, p]));
    expect(byName.get('author')!.type).toBe('link-to-type');
    expect(byName.get('rating')!.type).toBe('number');
    expect(byName.get('published')!.type).toBe('date');
    expect(byName.get('publisher')!.type).toBe('text');
    expect(byName.get('publisher')!.label).toBe('Publisher'); // title-cased
  });

  it('preserves declaration order', () => {
    const props = deriveTypeProperties({ zeta: 'x', alpha: 'y' });
    expect(props.map((p) => p.name)).toEqual(['zeta', 'alpha']);
  });
});
