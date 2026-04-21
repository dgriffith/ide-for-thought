import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/compact-yaml';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'compact-yaml': true }, configs: {} };

describe('compact-yaml (#155)', () => {
  it('strips a leading blank line inside frontmatter', () => {
    expect(formatContent('---\n\ntitle: foo\n---\n', enabled)).toBe(
      '---\ntitle: foo\n---\n',
    );
  });

  it('strips a trailing blank line inside frontmatter', () => {
    expect(formatContent('---\ntitle: foo\n\n---\n', enabled)).toBe(
      '---\ntitle: foo\n---\n',
    );
  });

  it('strips both ends', () => {
    expect(formatContent('---\n\n\ntitle: foo\n\n\n---\n', enabled)).toBe(
      '---\ntitle: foo\n---\n',
    );
  });

  it('leaves a compact frontmatter alone', () => {
    const src = '---\ntitle: foo\nauthor: Alice\n---\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is a no-op on files without frontmatter', () => {
    const src = 'plain body\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('---\n\ntitle: foo\n\n---\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
