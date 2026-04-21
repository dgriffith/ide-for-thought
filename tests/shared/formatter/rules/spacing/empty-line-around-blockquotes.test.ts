import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/empty-line-around-blockquotes';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'empty-line-around-blockquotes': true },
  configs: {},
};

describe('empty-line-around-blockquotes (#158)', () => {
  it('inserts blank lines around a blockquote jammed against prose', () => {
    const src = 'prose\n> quote line\nmore prose\n';
    expect(formatContent(src, enabled)).toBe(
      'prose\n\n> quote line\n\nmore prose\n',
    );
  });

  it('leaves a correctly-spaced blockquote alone', () => {
    const src = 'prose\n\n> quote\n\nmore\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('handles multi-line blockquotes as a single region', () => {
    const src = 'a\n> l1\n> l2\nb\n';
    expect(formatContent(src, enabled)).toBe('a\n\n> l1\n> l2\n\nb\n');
  });

  it('separates two adjacent blockquotes that share a gap', () => {
    const src = '> a\n> b\n> c\n';
    // Single contiguous blockquote region → no separation needed.
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not prepend when the blockquote is at the top', () => {
    const src = '> first\n\nafter\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const src = 'prose\n> quote\nmore\n';
    const once = formatContent(src, enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
