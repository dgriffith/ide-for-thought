import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/convert-tabs-to-spaces';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'convert-tabs-to-spaces': true }, configs: {} };

describe('convert-tabs-to-spaces (#158)', () => {
  it('replaces a leading tab with the configured width', () => {
    expect(formatContent('\thello\n', enabled)).toBe('    hello\n');
  });

  it('handles multiple leading tabs', () => {
    expect(formatContent('\t\ttext\n', enabled)).toBe('        text\n');
  });

  it('honours a non-default width', () => {
    const out = formatContent('\ttext\n', {
      enabled: { 'convert-tabs-to-spaces': true },
      configs: { 'convert-tabs-to-spaces': { width: 2 } },
    });
    expect(out).toBe('  text\n');
  });

  it('does not touch tabs inside a line', () => {
    expect(formatContent('hello\tworld\n', enabled)).toBe('hello\tworld\n');
  });

  it('skips content inside a fenced code block', () => {
    const src = '```\n\tkeep my tabs\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('\thello\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
