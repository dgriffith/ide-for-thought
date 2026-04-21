import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/remove-hyphenated-line-breaks';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'remove-hyphenated-line-breaks': true },
  configs: {},
};

describe('remove-hyphenated-line-breaks (#157)', () => {
  it('rejoins a letter-hyphen-newline-letter break', () => {
    expect(formatContent('some-\nthing\n', enabled)).toBe('something\n');
  });

  it('preserves legitimate hyphenated compounds (no newline after the hyphen)', () => {
    expect(formatContent('state-of-the-art\n', enabled)).toBe('state-of-the-art\n');
  });

  it('leaves a hyphen followed by an uppercase letter alone (probably a name or start-of-sentence)', () => {
    const src = 'sub-\nHeading\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('leaves a hyphen followed by a non-letter alone', () => {
    const src = 'first-\n1. item\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('handles CRLF line endings', () => {
    expect(formatContent('some-\r\nthing\n', enabled)).toBe('something\n');
  });

  it('does not touch breaks inside a code fence', () => {
    const src = '```\nsome-\nthing\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('some-\nthing\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
