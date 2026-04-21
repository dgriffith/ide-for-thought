import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/format-tags-in-yaml';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, prefix: 'bare' | 'hash' = 'bare', key: string = 'tags') {
  return formatContent(content, {
    enabled: { 'format-tags-in-yaml': true },
    configs: { 'format-tags-in-yaml': { prefix, key } },
  });
}

describe('format-tags-in-yaml (#155)', () => {
  it('strips leading `#` from tags in bare mode', () => {
    const out = run('---\ntags:\n  - "#foo"\n  - bar\n  - "#baz"\n---\n');
    expect(out).toContain('- foo');
    expect(out).toContain('- bar');
    expect(out).toContain('- baz');
    expect(out).not.toContain('#foo');
  });

  it('adds leading `#` to bare tags in hash mode', () => {
    const out = run('---\ntags:\n  - foo\n  - bar\n---\n', 'hash');
    expect(out).toContain('- "#foo"');
    expect(out).toContain('- "#bar"');
  });

  it('leaves already-correct tags alone (bare)', () => {
    const src = '---\ntags:\n  - foo\n  - bar\n---\n';
    expect(run(src, 'bare')).toBe(src);
  });

  it('can target a different tag-list key', () => {
    const src = '---\nlabels:\n  - "#foo"\n---\n';
    const out = run(src, 'bare', 'labels');
    expect(out).toContain('- foo');
  });

  it('is idempotent', () => {
    const once = run('---\ntags:\n  - "#foo"\n---\n', 'bare');
    expect(run(once, 'bare')).toBe(once);
  });
});
