import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/empty-line-around-math-blocks';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'empty-line-around-math-blocks': true },
  configs: {},
};

describe('empty-line-around-math-blocks (#158)', () => {
  it('inserts blank lines around a standalone $$…$$ block', () => {
    const src = 'before\n$$\nx = 1\n$$\nafter\n';
    expect(formatContent(src, enabled)).toBe(
      'before\n\n$$\nx = 1\n$$\n\nafter\n',
    );
  });

  it('leaves a properly-spaced block alone', () => {
    const src = 'before\n\n$$\nx = 1\n$$\n\nafter\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('ignores inline $…$ math', () => {
    const src = 'inline $a+b$ math in a paragraph\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('ignores $$…$$ that is embedded inline within a paragraph', () => {
    const src = 'text $$embedded$$ more text\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('skips $$…$$ inside a fenced code block', () => {
    const src = '```\n$$\nnot math\n$$\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const src = 'before\n$$\nx = 1\n$$\nafter\n';
    const once = formatContent(src, enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
