import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/remove-multiple-spaces';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'remove-multiple-spaces': true }, configs: {} };

describe('remove-multiple-spaces (#157)', () => {
  it('collapses double spaces between words', () => {
    expect(formatContent('hello  world\n', enabled)).toBe('hello world\n');
  });

  it('collapses long runs to a single space', () => {
    expect(formatContent('hello     world\n', enabled)).toBe('hello world\n');
  });

  it('leaves single spaces alone', () => {
    expect(formatContent('hello world\n', enabled)).toBe('hello world\n');
  });

  it('does not collapse leading indentation', () => {
    expect(formatContent('    indented\n', enabled)).toBe('    indented\n');
  });

  it('does not collapse trailing spaces (left for trailing-spaces rule)', () => {
    expect(formatContent('hello  \n', enabled)).toBe('hello  \n');
  });

  it('does not touch runs inside a code fence', () => {
    const src = '```\nhello  world\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('hello  world\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
