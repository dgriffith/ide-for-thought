import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/auto-correct-common-misspellings';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, extraCorrections?: Record<string, string>) {
  return formatContent(content, {
    enabled: { 'auto-correct-common-misspellings': true },
    configs: extraCorrections
      ? { 'auto-correct-common-misspellings': { extraCorrections } }
      : {},
  });
}

describe('auto-correct-common-misspellings (#157)', () => {
  it('corrects a simple misspelling from the default dictionary', () => {
    expect(run('teh cat\n')).toBe('the cat\n');
  });

  it('preserves sentence-start capitalisation', () => {
    expect(run('Teh cat\n')).toBe('The cat\n');
  });

  it('leaves correctly-spelled text alone', () => {
    const src = 'The cat is here.\n';
    expect(run(src)).toBe(src);
  });

  it('handles multiple corrections in one sentence', () => {
    expect(run('I recieve the package on tommorrow')).toBe(
      'I receive the package on tomorrow',
    );
  });

  it('accepts a user-supplied correction that augments the default dictionary', () => {
    expect(run('myWord here\n', { myword: 'my_word' })).toBe('my_word here\n');
  });

  it('lets a user override a default correction', () => {
    expect(run('teh cat\n', { teh: 'TEH!' })).toBe('TEH! cat\n');
  });

  it('does not touch misspellings inside code fences', () => {
    const src = '```\nteh code\n```\n';
    expect(run(src)).toBe(src);
  });

  it('does not touch misspellings inside inline code', () => {
    const src = 'see `teh function`\n';
    expect(run(src)).toBe(src);
  });

  it('respects word boundaries (does not correct inside a longer token)', () => {
    const src = 'otheh\n';
    expect(run(src)).toBe(src);
  });

  it('is idempotent', () => {
    const once = run('teh recieve\n');
    expect(run(once)).toBe(once);
  });
});
