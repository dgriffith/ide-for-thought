import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/add-blank-line-after-yaml';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'add-blank-line-after-yaml': true }, configs: {} };

describe('add-blank-line-after-yaml (#155)', () => {
  it('inserts a blank line when body starts immediately after `---`', () => {
    expect(formatContent('---\ntitle: foo\n---\nbody\n', enabled)).toBe(
      '---\ntitle: foo\n---\n\nbody\n',
    );
  });

  it('leaves a single blank line alone', () => {
    const src = '---\ntitle: foo\n---\n\nbody\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('collapses multiple blank lines down to one', () => {
    expect(formatContent('---\ntitle: foo\n---\n\n\n\nbody\n', enabled)).toBe(
      '---\ntitle: foo\n---\n\nbody\n',
    );
  });

  it('is a no-op on files without frontmatter', () => {
    const src = '# Heading\n\nbody\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('handles frontmatter-only files', () => {
    const src = '---\ntitle: foo\n---\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('---\ntitle: foo\n---\nbody\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
