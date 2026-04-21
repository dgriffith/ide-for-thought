import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/heading/capitalize-headings';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(
  content: string,
  style: 'title-case' | 'sentence-case' | 'lowercase' | 'off',
  properNouns: string[] = [],
) {
  return formatContent(content, {
    enabled: { 'capitalize-headings': true },
    configs: { 'capitalize-headings': { style, properNouns } },
  });
}

describe('capitalize-headings (#156)', () => {
  describe('style: title-case', () => {
    it('capitalises each major word', () => {
      expect(run('## the quick brown fox\n', 'title-case')).toBe(
        '## The Quick Brown Fox\n',
      );
    });

    it('leaves short words (a, an, the, …) lowercase unless at a boundary', () => {
      expect(run('## a brief history of time\n', 'title-case')).toBe(
        '## A Brief History of Time\n',
      );
    });

    it('preserves proper nouns', () => {
      expect(run('## learning javascript with minerva\n', 'title-case', ['JavaScript', 'Minerva'])).toBe(
        '## Learning JavaScript with Minerva\n',
      );
    });
  });

  describe('style: sentence-case', () => {
    it('capitalises only the first word', () => {
      expect(run('## THE QUICK BROWN FOX\n', 'sentence-case')).toBe(
        '## The quick brown fox\n',
      );
    });

    it('preserves proper nouns mid-sentence', () => {
      expect(run('## learning about JavaScript\n', 'sentence-case', ['JavaScript'])).toBe(
        '## Learning about JavaScript\n',
      );
    });
  });

  describe('style: lowercase', () => {
    it('lowercases everything', () => {
      expect(run('## Hello World\n', 'lowercase')).toBe('## hello world\n');
    });

    it('still preserves proper nouns', () => {
      expect(run('## Hello JavaScript\n', 'lowercase', ['JavaScript'])).toBe(
        '## hello JavaScript\n',
      );
    });
  });

  describe('style: off', () => {
    it('is a no-op', () => {
      const src = '## Some RaNdOm CaSe\n';
      expect(run(src, 'off')).toBe(src);
    });
  });

  describe('shared', () => {
    it('does not touch headings inside a code fence', () => {
      const src = '```\n## keep this\n```\n';
      expect(run(src, 'title-case')).toBe(src);
    });

    it('is idempotent (title-case)', () => {
      const once = run('## the quick brown fox\n', 'title-case');
      expect(run(once, 'title-case')).toBe(once);
    });

    it('is idempotent (sentence-case)', () => {
      const once = run('## THE QUICK BROWN FOX\n', 'sentence-case');
      expect(run(once, 'sentence-case')).toBe(once);
    });
  });
});
