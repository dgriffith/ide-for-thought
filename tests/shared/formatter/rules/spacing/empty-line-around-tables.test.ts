import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/empty-line-around-tables';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'empty-line-around-tables': true },
  configs: {},
};

describe('empty-line-around-tables (#158)', () => {
  it('adds blank lines around a table wedged against prose', () => {
    const src = 'before\n| a | b |\n| - | - |\n| 1 | 2 |\nafter\n';
    const out = formatContent(src, enabled);
    expect(out).toBe('before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter\n');
  });

  it('leaves a properly-spaced table alone', () => {
    const src = 'before\n\n| a | b |\n| - | - |\n\nafter\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('treats contiguous pipe-prefixed lines as a single table', () => {
    const src = 'a\n| x |\n| - |\n| y |\n| z |\nb\n';
    expect(formatContent(src, enabled)).toBe('a\n\n| x |\n| - |\n| y |\n| z |\n\nb\n');
  });

  it('does not pick up `|` characters inside a code fence', () => {
    const src = '```\n| not | a | table |\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not add leading blank when table is at top of file', () => {
    const src = '| a |\n| - |\nafter\n';
    expect(formatContent(src, enabled)).toBe('| a |\n| - |\n\nafter\n');
  });

  it('is idempotent', () => {
    const src = 'before\n| a | b |\n| - | - |\nafter\n';
    const once = formatContent(src, enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
