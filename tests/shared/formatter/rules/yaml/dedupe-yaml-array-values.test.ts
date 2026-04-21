import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/dedupe-yaml-array-values';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'dedupe-yaml-array-values': true },
  configs: {},
};

describe('dedupe-yaml-array-values (#155)', () => {
  it('drops duplicate tags, first occurrence wins', () => {
    const src = '---\ntags:\n  - a\n  - b\n  - a\n  - c\n  - b\n---\n';
    const out = formatContent(src, enabled);
    expect(out).toContain('- a');
    expect(out).toContain('- b');
    expect(out).toContain('- c');
    // Three unique tags, so three `- ` lines.
    expect((out.match(/^  - /gm) || []).length).toBe(3);
  });

  it('dedupes within flow-style sequences too', () => {
    const src = '---\ntags: [a, a, b]\n---\n';
    const out = formatContent(src, enabled);
    expect(out).toContain('[ a, b ]');
  });

  it('is a no-op on already-unique lists', () => {
    const src = '---\ntags:\n  - a\n  - b\n  - c\n---\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('leaves non-sequence values alone', () => {
    const src = '---\ntitle: foo\nauthor: Alice\n---\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is a no-op on files without frontmatter', () => {
    const src = 'body\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const src = '---\ntags:\n  - a\n  - a\n  - b\n---\n';
    const once = formatContent(src, enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
