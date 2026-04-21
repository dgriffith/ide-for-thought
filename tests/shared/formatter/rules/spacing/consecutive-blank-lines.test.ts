import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/consecutive-blank-lines';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, max?: number): string {
  return formatContent(content, {
    enabled: { 'consecutive-blank-lines': true },
    configs: max === undefined ? {} : { 'consecutive-blank-lines': { max } },
  });
}

describe('consecutive-blank-lines (#158)', () => {
  it('collapses runs of blank lines to the default max (1)', () => {
    expect(run('a\n\n\n\nb\n')).toBe('a\n\nb\n');
  });

  it('preserves a single blank line between paragraphs', () => {
    expect(run('a\n\nb\n')).toBe('a\n\nb\n');
  });

  it('honours max=0 by eliminating blank lines entirely', () => {
    expect(run('a\n\n\nb\n', 0)).toBe('a\nb\n');
  });

  it('honours max=2 by allowing up to two blank lines', () => {
    expect(run('a\n\n\n\n\nb\n', 2)).toBe('a\n\n\nb\n');
  });

  it('treats whitespace-only lines as blank lines', () => {
    expect(run('a\n   \n\t\n\nb\n')).toBe('a\n\nb\n');
  });

  it('does not collapse blank lines inside a fenced code block', () => {
    const src = '```\nfoo\n\n\n\nbar\n```\n';
    expect(run(src)).toBe(src);
  });

  it('does not touch blank lines inside YAML frontmatter', () => {
    const src = '---\ntitle: Foo\n\n\nmore: stuff\n---\n\nbody\n';
    expect(run(src)).toBe(src);
  });

  it('is idempotent', () => {
    const once = run('a\n\n\n\nb\n');
    expect(run(once)).toBe(once);
  });
});
