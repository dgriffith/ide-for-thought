import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/format-yaml-array';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, style: 'block' | 'flow', keys: string[] = []) {
  return formatContent(content, {
    enabled: { 'format-yaml-array': true },
    configs: { 'format-yaml-array': { style, keys } },
  });
}

describe('format-yaml-array (#155)', () => {
  it('converts a flow sequence to block style (default)', () => {
    const out = run('---\ntags: [a, b, c]\n---\n', 'block');
    expect(out).toContain('tags:\n  - a\n  - b\n  - c\n');
  });

  it('converts a block sequence to flow style', () => {
    const src = '---\ntags:\n  - a\n  - b\n  - c\n---\n';
    const out = run(src, 'flow');
    expect(out).toContain('tags: [ a, b, c ]');
  });

  it('only touches listed keys when `keys` is non-empty', () => {
    const src = '---\ntags: [a, b]\nauthors: [x, y]\n---\n';
    const out = run(src, 'block', ['tags']);
    expect(out).toContain('tags:\n  - a\n  - b\n');
    expect(out).toContain('authors: [ x, y ]');
  });

  it('leaves non-sequence values alone', () => {
    const src = '---\ntitle: foo\nauthor: Alice\n---\n';
    expect(run(src, 'block')).toBe(src);
  });

  it('is idempotent', () => {
    const once = run('---\ntags: [a, b]\n---\n', 'block');
    expect(run(once, 'block')).toBe(once);
  });
});
