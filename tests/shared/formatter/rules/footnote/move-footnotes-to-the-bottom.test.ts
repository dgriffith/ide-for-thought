import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/footnote/move-footnotes-to-the-bottom';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'move-footnotes-to-the-bottom': true },
  configs: {},
};

describe('move-footnotes-to-the-bottom (#159)', () => {
  it('collects a single definition and puts it at the bottom', () => {
    const src = 'body one[^1]\n\n[^1]: note text\n\nbody two\n';
    expect(formatContent(src, enabled)).toBe(
      'body one[^1]\n\nbody two\n\n[^1]: note text\n',
    );
  });

  it('preserves definition order', () => {
    const src = 'a[^2] b[^1]\n\n[^2]: second\n[^1]: first\n';
    expect(formatContent(src, enabled)).toBe(
      'a[^2] b[^1]\n\n[^2]: second\n[^1]: first\n',
    );
  });

  it('handles multi-line (indented) continuation definitions', () => {
    const src = [
      'body[^1]',
      '',
      '[^1]: first line',
      '    continuation',
      '    another',
      '',
      'tail',
      '',
    ].join('\n');
    const out = formatContent(src, enabled);
    expect(out).toContain('[^1]: first line\n    continuation\n    another\n');
    expect(out.indexOf('[^1]: first line')).toBeGreaterThan(out.indexOf('tail'));
  });

  it('is a no-op when there are no definitions', () => {
    const src = 'prose with ref[^1] but no def yet\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('leaves definitions alone when already at the bottom', () => {
    const src = 'body[^1]\n\n[^1]: note\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch definitions inside a code fence', () => {
    const src = 'prose\n\n```\n[^1]: not a real def\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const src = 'body one[^1]\n\n[^1]: note text\n\nbody two\n';
    const once = formatContent(src, enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
