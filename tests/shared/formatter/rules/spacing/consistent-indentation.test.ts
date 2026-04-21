import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/consistent-indentation';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, config?: { style: 'tabs' | 'spaces'; width?: number }) {
  return formatContent(content, {
    enabled: { 'consistent-indentation': true },
    configs: config
      ? { 'consistent-indentation': { width: 4, ...config } }
      : {},
  });
}

describe('consistent-indentation (#158)', () => {
  describe('style: spaces (default)', () => {
    it('replaces a leading tab with the configured width', () => {
      expect(run('\thello\n')).toBe('    hello\n');
    });

    it('handles multiple leading tabs', () => {
      expect(run('\t\ttext\n')).toBe('        text\n');
    });

    it('honours a non-default width', () => {
      expect(run('\ttext\n', { style: 'spaces', width: 2 })).toBe('  text\n');
    });

    it('does not touch tabs inside a line', () => {
      expect(run('hello\tworld\n')).toBe('hello\tworld\n');
    });
  });

  describe('style: tabs', () => {
    it('collapses 4 leading spaces to a tab', () => {
      expect(run('    hello\n', { style: 'tabs' })).toBe('\thello\n');
    });

    it('collapses 8 leading spaces to 2 tabs', () => {
      expect(run('        text\n', { style: 'tabs' })).toBe('\t\ttext\n');
    });

    it('keeps a partial-indent remainder as spaces', () => {
      expect(run('      text\n', { style: 'tabs' })).toBe('\t  text\n');
    });

    it('honours a non-default width', () => {
      expect(run('  text\n', { style: 'tabs', width: 2 })).toBe('\ttext\n');
    });

    it('does not touch spaces inside a line', () => {
      expect(run('hello    world\n', { style: 'tabs' })).toBe('hello    world\n');
    });
  });

  describe('shared behaviour', () => {
    it('skips content inside a fenced code block', () => {
      const src = '```\n\tkeep my indent\n```\n';
      expect(run(src)).toBe(src);
      expect(run(src, { style: 'tabs' })).toBe(src);
    });

    it('is idempotent (spaces)', () => {
      const once = run('\thello\n');
      expect(run(once)).toBe(once);
    });

    it('is idempotent (tabs)', () => {
      const once = run('    hello\n', { style: 'tabs' });
      expect(run(once, { style: 'tabs' })).toBe(once);
    });
  });
});
