import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/space-after-list-marker';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'space-after-list-marker': true }, configs: {} };

describe('space-after-list-marker (#158)', () => {
  it('collapses extra spaces after a dash marker', () => {
    expect(formatContent('-   item\n', enabled)).toBe('- item\n');
  });

  it('collapses extra spaces after asterisk and plus markers', () => {
    expect(formatContent('*  a\n+   b\n', enabled)).toBe('* a\n+ b\n');
  });

  it('collapses extra spaces after ordered markers (`1.` and `1)`)', () => {
    expect(formatContent('1.   item\n42)    other\n', enabled)).toBe(
      '1. item\n42) other\n',
    );
  });

  it('preserves existing single-space markers', () => {
    const src = '- one\n- two\n1. three\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('preserves indentation of nested list items', () => {
    expect(formatContent('  -   nested\n', enabled)).toBe('  - nested\n');
  });

  it('leaves bare dashes (empty list items) alone', () => {
    expect(formatContent('-\n', enabled)).toBe('-\n');
  });

  it('does not treat `*bold*` or `-text` as list markers', () => {
    const src = '*bold*\n-text\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch list-like lines inside code fences', () => {
    const src = '```\n-   not a list\n1.   also not\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('handles tabs between marker and content', () => {
    expect(formatContent('-\t\titem\n', enabled)).toBe('- item\n');
  });

  it('is idempotent', () => {
    const once = formatContent('-    item\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
