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

  // A CRLF note keeps its line ending (#2690): the engine runs rules on LF
  // text and maps the result back, so the one terminator left is `\r\n`. This
  // used to come back as `hello\n`, an LF ending on a CRLF note.
  it('collapses trailing \\r\\n terminators to one, keeping CRLF', () => {
    expect(formatContent('hello\r\n\r\n', enabled)).toBe('hello\r\n');
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
