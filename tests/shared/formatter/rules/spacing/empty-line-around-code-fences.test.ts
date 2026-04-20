import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/empty-line-around-code-fences';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'empty-line-around-code-fences': true },
  configs: {},
};

describe('empty-line-around-code-fences (#158)', () => {
  it('inserts a blank line before and after a fence jammed against content', () => {
    const src = 'before\n```js\nconst x = 1;\n```\nafter\n';
    const out = formatContent(src, enabled);
    expect(out).toBe('before\n\n```js\nconst x = 1;\n```\n\nafter\n');
  });

  it('leaves a fence that already has blank lines alone', () => {
    const src = 'before\n\n```js\nconst x = 1;\n```\n\nafter\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not add a blank line when the fence starts at the top of the file', () => {
    const src = '```\ncode\n```\n\nafter\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not add a blank line when the fence ends at the bottom of the file', () => {
    const src = 'before\n\n```\ncode\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('inserts blank lines on both sides for two adjacent fences', () => {
    const src = '```\nA\n```\n```\nB\n```\n';
    const out = formatContent(src, enabled);
    expect(out).toBe('```\nA\n```\n\n```\nB\n```\n');
  });

  it('respects the configured number of blank lines', () => {
    const out = formatContent('a\n```\nx\n```\nb\n', {
      enabled: { 'empty-line-around-code-fences': true },
      configs: { 'empty-line-around-code-fences': { before: 2, after: 2 } },
    });
    expect(out).toBe('a\n\n\n```\nx\n```\n\n\nb\n');
  });

  it('is idempotent', () => {
    const src = 'before\n```js\nconst x = 1;\n```\nafter\n';
    const once = formatContent(src, enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
