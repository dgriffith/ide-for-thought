import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/sort-yaml-array-values';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, keys?: string[]) {
  return formatContent(content, {
    enabled: { 'sort-yaml-array-values': true },
    configs: keys ? { 'sort-yaml-array-values': { keys } } : {},
  });
}

describe('sort-yaml-array-values (#155)', () => {
  it('sorts the default `tags` key alphabetically', () => {
    const src = '---\ntags:\n  - zed\n  - apple\n  - middle\n---\n';
    const out = run(src);
    expect(out).toMatch(/apple[\s\S]*middle[\s\S]*zed/);
  });

  it('leaves other keys alone by default', () => {
    const src = '---\nauthors:\n  - z\n  - a\n---\n';
    expect(run(src)).toBe(src);
  });

  it('sorts additional keys when configured', () => {
    const src = '---\nauthors:\n  - z\n  - a\n---\n';
    const out = run(src, ['authors']);
    expect(out).toMatch(/- a[\s\S]*- z/);
  });

  it('is a no-op when the keys list is empty', () => {
    const src = '---\ntags:\n  - z\n  - a\n---\n';
    expect(run(src, [])).toBe(src);
  });

  it('is idempotent', () => {
    const src = '---\ntags:\n  - z\n  - a\n---\n';
    const once = run(src);
    expect(run(once)).toBe(once);
  });
});
