import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/yaml-key-sort';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, canonicalOrder?: string[]) {
  return formatContent(content, {
    enabled: { 'yaml-key-sort': true },
    configs: canonicalOrder ? { 'yaml-key-sort': { canonicalOrder } } : {},
  });
}

describe('yaml-key-sort (#155)', () => {
  it('sorts keys into the default canonical order', () => {
    const src = '---\ntags: [a]\ncreated: 2025-01-01\ntitle: foo\n---\n';
    const out = run(src);
    // Order in default: title → created → tags.
    const lines = out.split('\n').filter((l) => !/^---|^\s*$/.test(l));
    expect(lines[0]).toMatch(/^title:/);
    expect(lines[1]).toMatch(/^created:/);
    expect(lines[2]).toMatch(/^tags:/);
  });

  it('places unknown keys alphabetically after canonical', () => {
    const src = '---\nzebra: 1\napple: 2\ntitle: foo\n---\n';
    const out = run(src);
    const lines = out.split('\n').filter((l) => !/^---|^\s*$/.test(l));
    expect(lines[0]).toMatch(/^title:/);
    expect(lines[1]).toMatch(/^apple:/);
    expect(lines[2]).toMatch(/^zebra:/);
  });

  it('respects a user-supplied order', () => {
    const src = '---\nb: 1\na: 2\n---\n';
    const out = run(src, ['b', 'a']);
    const lines = out.split('\n').filter((l) => !/^---|^\s*$/.test(l));
    expect(lines[0]).toMatch(/^b:/);
    expect(lines[1]).toMatch(/^a:/);
  });

  it('is idempotent', () => {
    const src = '---\ntags: [a]\ntitle: foo\n---\n';
    const once = run(src);
    expect(run(once)).toBe(once);
  });
});
