import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/proper-ellipsis';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'proper-ellipsis': true }, configs: {} };

describe('proper-ellipsis (#157)', () => {
  it('collapses `...` into `…`', () => {
    expect(formatContent('Wait...\n', enabled)).toBe('Wait…\n');
  });

  it('ignores a single or double dot', () => {
    expect(formatContent('End. And.. more\n', enabled)).toBe('End. And.. more\n');
  });

  it('reduces four dots to `….` (three get replaced, fourth left as-is)', () => {
    expect(formatContent('oh....\n', enabled)).toBe('oh….\n');
  });

  it('does not touch `...` inside a code fence', () => {
    const src = '```\nif (...) {}\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch `...` inside inline code', () => {
    const src = 'see `foo...bar`\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('Wait...\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
