import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/heading-blank-lines';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'heading-blank-lines': true }, configs: {} };

describe('heading-blank-lines (#158)', () => {
  it('adds blank lines around a heading wedged against text', () => {
    const src = 'prose\n## Heading\nmore prose\n';
    expect(formatContent(src, enabled)).toBe('prose\n\n## Heading\n\nmore prose\n');
  });

  it('handles all six ATX heading levels', () => {
    for (let n = 1; n <= 6; n++) {
      const marker = '#'.repeat(n);
      const src = `a\n${marker} Title\nb\n`;
      expect(formatContent(src, enabled)).toBe(`a\n\n${marker} Title\n\nb\n`);
    }
  });

  it('leaves a properly-spaced heading alone', () => {
    const src = 'a\n\n## Heading\n\nb\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('separates two adjacent headings', () => {
    const src = '## A\n## B\n';
    expect(formatContent(src, enabled)).toBe('## A\n\n## B\n');
  });

  it('respects a configurable before/after count', () => {
    const out = formatContent('a\n## H\nb\n', {
      enabled: { 'heading-blank-lines': true },
      configs: { 'heading-blank-lines': { before: 2, after: 1 } },
    });
    expect(out).toBe('a\n\n\n## H\n\nb\n');
  });

  it('does not treat `#hashtag` as a heading (no trailing space)', () => {
    const src = 'a\n#hashtag\nb\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch `#` inside a code fence', () => {
    const src = '```\n# Not a heading\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('a\n## H\nb\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
