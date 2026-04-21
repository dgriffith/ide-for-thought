import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/insert-yaml-attributes';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, keys: string[]) {
  return formatContent(content, {
    enabled: { 'insert-yaml-attributes': true },
    configs: { 'insert-yaml-attributes': { keys } },
  });
}

describe('insert-yaml-attributes (#155)', () => {
  it('adds a missing key with an empty value', () => {
    const out = run('---\ntitle: foo\n---\n', ['author']);
    expect(out).toContain('author:');
  });

  it('leaves an existing key alone', () => {
    const src = '---\ntitle: foo\nauthor: Alice\n---\n';
    const out = run(src, ['author']);
    expect(out).toContain('author: Alice');
  });

  it('adds multiple missing keys', () => {
    const out = run('---\ntitle: foo\n---\n', ['author', 'created']);
    expect(out).toContain('author:');
    expect(out).toContain('created:');
  });

  it('is a no-op when the keys list is empty', () => {
    const src = '---\ntitle: foo\n---\n';
    expect(run(src, [])).toBe(src);
  });

  it('is idempotent', () => {
    const once = run('---\ntitle: foo\n---\n', ['author']);
    expect(run(once, ['author'])).toBe(once);
  });
});
