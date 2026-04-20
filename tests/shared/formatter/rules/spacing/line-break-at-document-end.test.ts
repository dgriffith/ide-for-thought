import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/line-break-at-document-end';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'line-break-at-document-end': true }, configs: {} };

describe('line-break-at-document-end (#158)', () => {
  it('adds a newline when missing', () => {
    expect(formatContent('hello', enabled)).toBe('hello\n');
  });

  it('collapses multiple trailing newlines to one', () => {
    expect(formatContent('hello\n\n\n', enabled)).toBe('hello\n');
  });

  it('leaves a single-trailing-newline document untouched', () => {
    expect(formatContent('hello\n', enabled)).toBe('hello\n');
  });

  it('preserves a trailing-newline after normalising \\r\\n terminators', () => {
    expect(formatContent('hello\r\n\r\n', enabled)).toBe('hello\n');
  });

  it('leaves empty content empty', () => {
    expect(formatContent('', enabled)).toBe('');
  });

  it('normalises content that is only newlines', () => {
    expect(formatContent('\n\n\n', enabled)).toBe('\n');
  });

  it('does not strip trailing spaces on the last line', () => {
    expect(formatContent('hello  ', enabled)).toBe('hello  \n');
  });

  it('is idempotent', () => {
    const once = formatContent('hello\n\n\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
