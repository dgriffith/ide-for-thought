import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/footnote/footnote-after-punctuation';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'footnote-after-punctuation': true },
  configs: {},
};

describe('footnote-after-punctuation (#159)', () => {
  it('moves a ref from before a period to after it', () => {
    expect(formatContent('word[^1].', enabled)).toBe('word.[^1]');
  });

  it('handles question marks and exclamation points', () => {
    expect(formatContent('really[^1]?', enabled)).toBe('really?[^1]');
    expect(formatContent('wow[^1]!', enabled)).toBe('wow![^1]');
  });

  it('handles commas, semicolons, and colons', () => {
    expect(formatContent('first[^1], second[^2]; third[^3]:', enabled)).toBe(
      'first,[^1] second;[^2] third:[^3]',
    );
  });

  it('handles named footnotes', () => {
    expect(formatContent('word[^foo].', enabled)).toBe('word.[^foo]');
  });

  it('leaves a correctly-placed ref alone', () => {
    const src = 'word.[^1]';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('leaves a standalone ref (no punctuation after) alone', () => {
    const src = 'word[^1] continues\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch refs inside a code fence', () => {
    const src = '```\nword[^1].\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch refs inside inline code', () => {
    const src = 'see `word[^1].`\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('word[^1].', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
