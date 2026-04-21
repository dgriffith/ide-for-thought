import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/move-math-block-indicators';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'move-math-block-indicators-to-their-own-line': true },
  configs: {},
};

describe('move-math-block-indicators-to-their-own-line (#158)', () => {
  it('splits a `$$x$$` on its own line into three lines', () => {
    expect(formatContent('$$x$$\n', enabled)).toBe('$$\nx\n$$\n');
  });

  it('splits a `$$x$$` embedded in a sentence', () => {
    expect(formatContent('before $$x$$ after\n', enabled)).toBe(
      'before \n$$\nx\n$$\n after\n',
    );
  });

  it('leaves already-multi-line $$…$$ blocks alone', () => {
    const src = '$$\nx = 1\n$$\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('leaves inline $…$ (single dollar) math alone', () => {
    const src = 'inline $a + b$ math\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('trims whitespace around the inner content', () => {
    expect(formatContent('$$   x   $$\n', enabled)).toBe('$$\nx\n$$\n');
  });

  it('handles multiple inline math spans on one line', () => {
    expect(formatContent('a $$x$$ b $$y$$ c\n', enabled)).toBe(
      'a \n$$\nx\n$$\n b \n$$\ny\n$$\n c\n',
    );
  });

  it('does not touch $$ inside a code fence', () => {
    const src = '```\n$$x$$\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('$$x$$\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
