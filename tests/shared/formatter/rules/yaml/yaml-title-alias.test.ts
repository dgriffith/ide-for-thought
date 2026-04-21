import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/yaml-title-alias';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'yaml-title-alias': true }, configs: {} };

describe('yaml-title-alias (#155)', () => {
  it('adds an aliases key with the title when aliases is missing', () => {
    const out = formatContent('---\ntitle: Foo\n---\n', enabled);
    expect(out).toContain('aliases:');
    expect(out).toMatch(/aliases:\s*\n?\s*-?\s*Foo/);
  });

  it('appends the title to an existing aliases list when absent', () => {
    const src = '---\ntitle: Foo\naliases:\n  - Bar\n---\n';
    const out = formatContent(src, enabled);
    expect(out).toContain('- Bar');
    expect(out).toContain('- Foo');
  });

  it('leaves aliases alone if it already contains the title', () => {
    const src = '---\ntitle: Foo\naliases:\n  - Foo\n  - Bar\n---\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is a no-op when no title key is set', () => {
    const src = '---\nauthor: Alice\n---\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('---\ntitle: Foo\n---\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
