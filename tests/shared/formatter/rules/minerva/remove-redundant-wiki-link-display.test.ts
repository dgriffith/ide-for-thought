import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/minerva/remove-redundant-wiki-link-display';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'remove-redundant-wiki-link-display': true },
  configs: {},
};

describe('remove-redundant-wiki-link-display (#161)', () => {
  it('removes exact duplicate display aliases', () => {
    expect(formatContent('[[notes/foo|notes/foo]]', enabled)).toBe('[[notes/foo]]');
  });

  it('removes display aliases that only differ in `.md` extension', () => {
    expect(formatContent('[[notes/foo.md|notes/foo]]', enabled)).toBe('[[notes/foo.md]]');
    expect(formatContent('[[notes/foo|notes/foo.md]]', enabled)).toBe('[[notes/foo]]');
  });

  it('leaves meaningful display aliases alone', () => {
    const src = '[[notes/foo|Friendly Label]]';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('leaves links without a display alone', () => {
    const src = '[[notes/foo]]';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('preserves type prefix and anchor when dropping the alias', () => {
    expect(formatContent('[[notes/foo#section|notes/foo]]', enabled)).toBe(
      '[[notes/foo#section]]',
    );
  });

  it('does not touch links inside a code fence', () => {
    const src = '```\n[[notes/foo|notes/foo]]\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('[[notes/foo|notes/foo]]', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
