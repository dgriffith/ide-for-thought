import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/footnote/re-index-footnotes';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 're-index-footnotes': true }, configs: {} };

describe('re-index-footnotes (#159)', () => {
  it('renumbers numeric refs 1, 2, 3 in document order', () => {
    const src = 'a[^5] b[^3] c[^2]\n\n[^2]: two\n[^3]: three\n[^5]: five\n';
    expect(formatContent(src, enabled)).toBe(
      'a[^1] b[^2] c[^3]\n\n[^3]: two\n[^2]: three\n[^1]: five\n',
    );
  });

  it('keeps repeated refs to the same number', () => {
    const src = 'a[^7] b[^7] c[^7]\n\n[^7]: note\n';
    expect(formatContent(src, enabled)).toBe('a[^1] b[^1] c[^1]\n\n[^1]: note\n');
  });

  it('preserves named footnotes', () => {
    expect(formatContent('a[^foo] b[^bar] c[^1]\n', enabled)).toBe(
      'a[^foo] b[^bar] c[^1]\n',
    );
  });

  it('handles mixed named and numeric — named stays, numeric gets renumbered', () => {
    expect(formatContent('a[^3] b[^foo] c[^5]\n', enabled)).toBe(
      'a[^1] b[^foo] c[^2]\n',
    );
  });

  it('is a no-op on a document with already-sequential numbering', () => {
    const src = 'a[^1] b[^2] c[^3]\n\n[^1]: one\n[^2]: two\n[^3]: three\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch refs inside a code fence', () => {
    const src = '```\n[^99]: keep\n[^99] ref\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const src = 'a[^5] b[^3]\n\n[^3]: x\n[^5]: y\n';
    const once = formatContent(src, enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
