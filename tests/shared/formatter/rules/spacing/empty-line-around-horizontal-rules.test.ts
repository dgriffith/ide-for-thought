import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/empty-line-around-horizontal-rules';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'empty-line-around-horizontal-rules': true },
  configs: {},
};

describe('empty-line-around-horizontal-rules (#158)', () => {
  it('adds blank lines around a `---` HR wedged between text', () => {
    const src = 'before\n---\nafter\n';
    expect(formatContent(src, enabled)).toBe('before\n\n---\n\nafter\n');
  });

  it('recognises `***` and `___` variants', () => {
    expect(formatContent('a\n***\nb\n', enabled)).toBe('a\n\n***\n\nb\n');
    expect(formatContent('a\n___\nb\n', enabled)).toBe('a\n\n___\n\nb\n');
  });

  it('recognises spaced HRs (`- - -`, `* * *`)', () => {
    expect(formatContent('a\n- - -\nb\n', enabled)).toBe('a\n\n- - -\n\nb\n');
    expect(formatContent('a\n* * *\nb\n', enabled)).toBe('a\n\n* * *\n\nb\n');
  });

  it('leaves a properly-spaced HR alone', () => {
    const src = 'a\n\n---\n\nb\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch YAML frontmatter `---` fences', () => {
    const src = '---\ntitle: foo\n---\n\nbody\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch `---` inside a code fence', () => {
    const src = '```\n---\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not treat `--` (only two dashes) as an HR', () => {
    const src = 'a\n--\nb\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('before\n---\nafter\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
