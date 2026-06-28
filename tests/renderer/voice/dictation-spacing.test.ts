/**
 * Spacing logic for inserting transcribed text into the editor (#voice P2).
 */

import { describe, it, expect } from 'vitest';
import { withLeadingSpace } from '../../../src/renderer/lib/editor/dictation';

describe('withLeadingSpace', () => {
  it('adds a space when joining onto a word character', () => {
    expect(withLeadingSpace('t', 'sat')).toBe(' sat');
  });

  it('does not add a space at the start of the document', () => {
    expect(withLeadingSpace('', 'Hello')).toBe('Hello');
  });

  it('does not double up after existing whitespace', () => {
    expect(withLeadingSpace(' ', 'world')).toBe('world');
    expect(withLeadingSpace('\n', 'world')).toBe('world');
  });

  it('does not add a space after an opening bracket or quote', () => {
    expect(withLeadingSpace('(', 'aside')).toBe('aside');
    expect(withLeadingSpace('"', 'quote')).toBe('quote');
    expect(withLeadingSpace('“', 'quote')).toBe('quote');
  });

  it('adds a space after sentence punctuation', () => {
    expect(withLeadingSpace('.', 'Next')).toBe(' Next');
    expect(withLeadingSpace(',', 'then')).toBe(' then');
  });

  it('returns empty text unchanged', () => {
    expect(withLeadingSpace('a', '')).toBe('');
  });
});
