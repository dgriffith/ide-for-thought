import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/remove-yaml-keys';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, keys: string[]) {
  return formatContent(content, {
    enabled: { 'remove-yaml-keys': true },
    configs: { 'remove-yaml-keys': { keys } },
  });
}

describe('remove-yaml-keys (#155)', () => {
  it('removes a single listed key', () => {
    const out = run('---\ntitle: foo\ndrafted: true\n---\n', ['drafted']);
    expect(out).toBe('---\ntitle: foo\n---\n');
  });

  it('removes multiple listed keys', () => {
    const out = run('---\na: 1\nb: 2\nc: 3\n---\n', ['a', 'c']);
    expect(out).toBe('---\nb: 2\n---\n');
  });

  it('leaves other keys untouched', () => {
    const out = run('---\ntitle: foo\nauthor: Alice\n---\n', ['nonexistent']);
    expect(out).toBe('---\ntitle: foo\nauthor: Alice\n---\n');
  });

  it('is a no-op when the keys list is empty', () => {
    const src = '---\ntitle: foo\n---\n';
    expect(run(src, [])).toBe(src);
  });

  it('is idempotent', () => {
    const once = run('---\ntitle: foo\ndraft: true\n---\n', ['draft']);
    expect(run(once, ['draft'])).toBe(once);
  });
});
