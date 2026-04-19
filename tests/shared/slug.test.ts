import { describe, it, expect } from 'vitest';
import { slugify, splitAnchor } from '../../src/shared/slug';

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips punctuation', () => {
    expect(slugify("Don't stop!")).toBe('dont-stop');
    expect(slugify('What is the (meaning) of this?')).toBe('what-is-the-meaning-of-this');
  });

  it('collapses repeated hyphens and trims edges', () => {
    expect(slugify('  foo   bar  ')).toBe('foo-bar');
    expect(slugify('--foo--bar--')).toBe('foo-bar');
  });

  it('is idempotent', () => {
    const once = slugify('Some Long Heading — With dashes!');
    expect(slugify(once)).toBe(once);
  });

  it('keeps underscores and numeric chars (word chars)', () => {
    expect(slugify('foo_bar 42')).toBe('foo_bar-42');
  });
});

describe('splitAnchor', () => {
  it('returns null anchor when no # present', () => {
    expect(splitAnchor('notes/foo')).toEqual({ path: 'notes/foo', anchor: null });
  });

  it('splits heading anchors', () => {
    expect(splitAnchor('notes/foo#components')).toEqual({
      path: 'notes/foo',
      anchor: 'components',
    });
  });

  it('splits block-id anchors (leading ^ preserved)', () => {
    expect(splitAnchor('notes/foo#^p4')).toEqual({
      path: 'notes/foo',
      anchor: '^p4',
    });
  });

  it('splits at first # if multiple exist', () => {
    expect(splitAnchor('notes/foo#a#b')).toEqual({
      path: 'notes/foo',
      anchor: 'a#b',
    });
  });
});
