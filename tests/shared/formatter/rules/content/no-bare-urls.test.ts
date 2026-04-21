import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/no-bare-urls';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'no-bare-urls': true }, configs: {} };

describe('no-bare-urls (#157)', () => {
  it('wraps a standalone URL in angle brackets', () => {
    expect(formatContent('https://example.com\n', enabled)).toBe(
      '<https://example.com>\n',
    );
  });

  it('wraps URLs with leading indentation', () => {
    expect(formatContent('  https://example.com\n', enabled)).toBe(
      '  <https://example.com>\n',
    );
  });

  it('wraps http and ftp as well as https', () => {
    expect(formatContent('http://example.com\n', enabled)).toBe('<http://example.com>\n');
    expect(formatContent('ftp://example.com\n', enabled)).toBe('<ftp://example.com>\n');
  });

  it('leaves an already-bracketed URL alone', () => {
    const src = '<https://example.com>\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch URLs that share a line with other text', () => {
    const src = 'see https://example.com for details\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch URLs in markdown link syntax', () => {
    const src = '[text](https://example.com)\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch URLs inside a code fence', () => {
    const src = '```\nhttps://example.com\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('https://example.com\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
