import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/convert-spaces-to-tabs';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'convert-spaces-to-tabs': true }, configs: {} };

describe('convert-spaces-to-tabs (#158)', () => {
  it('collapses 4 leading spaces to a tab', () => {
    expect(formatContent('    hello\n', enabled)).toBe('\thello\n');
  });

  it('collapses 8 leading spaces to 2 tabs', () => {
    expect(formatContent('        text\n', enabled)).toBe('\t\ttext\n');
  });

  it('keeps a partial-indent remainder as spaces', () => {
    expect(formatContent('      text\n', enabled)).toBe('\t  text\n');
  });

  it('honours a non-default width', () => {
    const out = formatContent('  text\n', {
      enabled: { 'convert-spaces-to-tabs': true },
      configs: { 'convert-spaces-to-tabs': { width: 2 } },
    });
    expect(out).toBe('\ttext\n');
  });

  it('does not touch spaces inside a line', () => {
    expect(formatContent('hello    world\n', enabled)).toBe('hello    world\n');
  });

  it('skips content inside a fenced code block', () => {
    const src = '```\n    keep my spaces\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('    hello\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
