import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/unordered-list-marker-style';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, marker: '-' | '*' | '+' = '-') {
  return formatContent(content, {
    enabled: { 'unordered-list-marker-style': true },
    configs: { 'unordered-list-marker-style': { marker } },
  });
}

describe('unordered-list-marker-style (#157)', () => {
  it('converts `*` items to the target marker', () => {
    expect(run('* one\n* two\n', '-')).toBe('- one\n- two\n');
  });

  it('converts `+` items to the target marker', () => {
    expect(run('+ one\n+ two\n', '-')).toBe('- one\n- two\n');
  });

  it('leaves items matching the target marker alone', () => {
    const src = '- one\n- two\n';
    expect(run(src, '-')).toBe(src);
  });

  it('preserves indentation for nested items', () => {
    expect(run('- one\n  * nested\n- two\n', '-')).toBe(
      '- one\n  - nested\n- two\n',
    );
  });

  it('does not touch `* * *` horizontal rules', () => {
    const src = '* * *\n';
    expect(run(src, '-')).toBe(src);
  });

  it('does not rewrite a line that would become an HR', () => {
    const src = '- - -\n';
    expect(run(src, '*')).toBe(src);
  });

  it('does not touch items inside a code fence', () => {
    const src = '```\n* item\n```\n';
    expect(run(src, '-')).toBe(src);
  });

  it('converts to `+` when configured', () => {
    expect(run('- one\n', '+')).toBe('+ one\n');
  });

  it('is idempotent', () => {
    const once = run('* one\n* two\n', '-');
    expect(run(once, '-')).toBe(once);
  });
});
