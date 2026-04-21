import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/blockquote-style';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'blockquote-style': true }, configs: {} };

describe('blockquote-style (#157)', () => {
  it('inserts a space after `>` when followed by non-space content', () => {
    expect(formatContent('>hello\n', enabled)).toBe('> hello\n');
  });

  it('leaves `> hello` alone', () => {
    const src = '> hello\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('leaves a bare `>` continuation line alone', () => {
    const src = '> first\n>\n> third\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('handles nested `>>` markers', () => {
    expect(formatContent('>>deeply\n', enabled)).toBe('>> deeply\n');
  });

  it('does not touch `>` characters in regular prose', () => {
    const src = '5 > 3 and foo > bar\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch `>` inside a code fence', () => {
    const src = '```\n>not a quote\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('normalises every line in a multi-line blockquote', () => {
    expect(formatContent('>one\n>two\n>three\n', enabled)).toBe(
      '> one\n> two\n> three\n',
    );
  });

  it('is idempotent', () => {
    const once = formatContent('>hello\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
