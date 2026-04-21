import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/trailing-spaces';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'trailing-spaces': true }, configs: {} };

describe('trailing-spaces (#158)', () => {
  it('strips trailing spaces from a single line', () => {
    expect(formatContent('hello   \nworld  \n', enabled)).toBe('hello\nworld\n');
  });

  it('strips trailing tabs', () => {
    expect(formatContent('hello\t\t\nworld\t\n', enabled)).toBe('hello\nworld\n');
  });

  it('strips mixed trailing whitespace on the last line even with no newline', () => {
    expect(formatContent('hello  \t ', enabled)).toBe('hello');
  });

  it('does not strip whitespace inside a line', () => {
    expect(formatContent('hello   world\n', enabled)).toBe('hello   world\n');
  });

  it('preserves indentation at the start of lines', () => {
    expect(formatContent('  indented  \n', enabled)).toBe('  indented\n');
  });

  it('does not touch trailing whitespace inside a fenced code block', () => {
    const src = '```\nx =  \ny =  \n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch trailing whitespace inside YAML frontmatter', () => {
    const src = '---\ntitle: Foo  \n---\n\nbody  \n';
    expect(formatContent(src, enabled)).toBe('---\ntitle: Foo  \n---\n\nbody\n');
  });

  it('handles CRLF line endings', () => {
    expect(formatContent('hello  \r\nworld  \r\n', enabled)).toBe('hello\r\nworld\r\n');
  });

  it('is idempotent', () => {
    const once = formatContent('hello  \nworld  \n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
