import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/remove-consecutive-list-markers';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'remove-consecutive-list-markers': true },
  configs: {},
};

describe('remove-consecutive-list-markers (#157)', () => {
  it('collapses `- - item` to `- item`', () => {
    expect(formatContent('- - item\n', enabled)).toBe('- item\n');
  });

  it('collapses three consecutive markers', () => {
    expect(formatContent('- - - item\n', enabled)).toBe('- item\n');
  });

  it('works on asterisk and plus', () => {
    expect(formatContent('* * item\n', enabled)).toBe('* item\n');
    expect(formatContent('+ + item\n', enabled)).toBe('+ item\n');
  });

  it('preserves leading indentation', () => {
    expect(formatContent('  - - nested\n', enabled)).toBe('  - nested\n');
  });

  it('leaves a single-marker item alone', () => {
    const src = '- item\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch an HR made of spaced markers', () => {
    const src = '* * *\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch consecutive markers inside a code fence', () => {
    const src = '```\n- - item\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('- - - item\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
