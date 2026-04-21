import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/remove-link-spacing';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'remove-link-spacing': true }, configs: {} };

describe('remove-link-spacing (#158)', () => {
  it('trims whitespace around link text and URL', () => {
    expect(formatContent('[ foo ]( bar )', enabled)).toBe('[foo](bar)');
  });

  it('leaves tight links alone', () => {
    const src = '[foo](bar)\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('handles a link embedded inside prose', () => {
    expect(formatContent('see [ docs ]( http://x ) for details\n', enabled)).toBe(
      'see [docs](http://x) for details\n',
    );
  });

  it('trims whitespace around image-link text', () => {
    expect(formatContent('![ alt ]( path )\n', enabled)).toBe('![alt](path)\n');
  });

  it('does not touch wiki-links', () => {
    const src = '[[ notes/foo ]]\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch links inside a code fence', () => {
    const src = '```\n[ foo ]( bar )\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('preserves titles with their quotes', () => {
    expect(formatContent('[ foo ]( bar "title text" )\n', enabled)).toBe(
      '[foo](bar "title text")\n',
    );
  });

  it('is idempotent', () => {
    const once = formatContent('[ foo ]( bar )\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
