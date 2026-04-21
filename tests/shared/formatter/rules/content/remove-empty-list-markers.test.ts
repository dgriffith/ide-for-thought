import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/remove-empty-list-markers';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'remove-empty-list-markers': true }, configs: {} };

describe('remove-empty-list-markers (#157)', () => {
  it('blanks a line containing only a dash', () => {
    expect(formatContent('a\n-\nb\n', enabled)).toBe('a\n\nb\n');
  });

  it('blanks a line containing only an asterisk or plus', () => {
    expect(formatContent('*\n', enabled)).toBe('\n');
    expect(formatContent('+\n', enabled)).toBe('\n');
  });

  it('blanks an empty ordered list marker', () => {
    expect(formatContent('1.\n', enabled)).toBe('\n');
    expect(formatContent('42)\n', enabled)).toBe('\n');
  });

  it('blanks markers with trailing whitespace', () => {
    expect(formatContent('-   \n', enabled)).toBe('\n');
  });

  it('leaves populated list items alone', () => {
    const src = '- one\n- two\n1. three\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not blank markers inside a code fence', () => {
    const src = '```\n-\n1.\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('a\n-\nb\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
