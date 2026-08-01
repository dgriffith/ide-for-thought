/**
 * Frontmatter patch + read for the typed-property form (#1066). The form is a
 * view over frontmatter: edits must round-trip through YAML without disturbing
 * the body, other keys, or comments.
 */
import { describe, it, expect } from 'vitest';
import { setFrontmatterProperty, getFrontmatterValues } from '../../src/shared/frontmatter-edit';

const NOTE = `---
type: book
author: Frank Herbert
rating: 4
---
# Dune

Body text.
`;

describe('setFrontmatterProperty (#1066)', () => {
  it('updates an existing key, leaving body + other keys intact', () => {
    const out = setFrontmatterProperty(NOTE, 'rating', 5);
    expect(out).toContain('rating: 5');
    expect(out).toContain('author: Frank Herbert');
    expect(out).toContain('type: book');
    expect(out).toContain('# Dune\n\nBody text.');
  });

  it('adds a new key not yet present', () => {
    const out = setFrontmatterProperty(NOTE, 'published', '1965-08-01');
    expect(out).toMatch(/published: '?1965-08-01'?/);
    expect(out).toContain('# Dune');
  });

  it('clearing a value removes the key (the form still renders it from schema)', () => {
    const out = setFrontmatterProperty(NOTE, 'author', '');
    expect(out).not.toContain('author');
    expect(out).toContain('rating: 4'); // siblings + body intact
    expect(out).toContain('# Dune');
    expect(getFrontmatterValues(out).author).toBeUndefined();
  });

  it('dropping the last key removes the whole frontmatter block', () => {
    const out = setFrontmatterProperty('---\nonly: x\n---\nbody\n', 'only', '');
    expect(out).toBe('body\n');
  });

  it('creates a frontmatter block when the note has none', () => {
    const out = setFrontmatterProperty('# Just a body\n', 'type', 'idea');
    expect(out).toBe('---\ntype: idea\n---\n# Just a body\n');
  });

  it('refuses to touch malformed frontmatter (returns unchanged)', () => {
    const bad = '---\nkey: [unclosed\n---\nbody';
    expect(setFrontmatterProperty(bad, 'x', '1')).toBe(bad);
  });

  it('writes a number unquoted and a string as text', () => {
    expect(setFrontmatterProperty(NOTE, 'rating', 3)).toContain('rating: 3');
    expect(setFrontmatterProperty(NOTE, 'author', 'Herbert')).toContain('author: Herbert');
  });
});

describe('getFrontmatterValues (#1066)', () => {
  it('reads scalars as display strings', () => {
    const v = getFrontmatterValues(NOTE);
    expect(v).toMatchObject({ type: 'book', author: 'Frank Herbert', rating: '4' });
  });

  it('renders a date value as YYYY-MM-DD', () => {
    const v = getFrontmatterValues('---\npublished: 2020-06-01\n---\n');
    expect(v.published).toBe('2020-06-01');
  });

  it('is empty for a note with no frontmatter', () => {
    expect(getFrontmatterValues('# no frontmatter')).toEqual({});
  });

  it('preserves a wiki-link value verbatim (link-to-type)', () => {
    const v = getFrontmatterValues('---\nowner: "[[Alice]]"\n---\n');
    expect(v.owner).toBe('[[Alice]]');
  });
});
