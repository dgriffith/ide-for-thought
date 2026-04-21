import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/ordered-list-style';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, style: 'increment' | 'same' = 'increment') {
  return formatContent(content, {
    enabled: { 'ordered-list-style': true },
    configs: { 'ordered-list-style': { style } },
  });
}

describe('ordered-list-style (#157)', () => {
  describe('style: increment', () => {
    it('renumbers a list that starts with wrong numbers', () => {
      expect(run('3. a\n4. b\n7. c\n')).toBe('1. a\n2. b\n3. c\n');
    });

    it('handles `1.` that should stay `1.`', () => {
      const src = '1. a\n2. b\n';
      expect(run(src)).toBe(src);
    });

    it('keeps blank lines as part of the same list', () => {
      expect(run('1. a\n2. b\n\n3. c\n')).toBe('1. a\n2. b\n\n3. c\n');
    });

    it('resets numbering after a non-list, non-blank line', () => {
      expect(run('5. a\n6. b\n\nparagraph\n\n1. c\n')).toBe(
        '1. a\n2. b\n\nparagraph\n\n1. c\n',
      );
    });

    it('tracks nested lists separately per indent', () => {
      expect(run('1. a\n   3. nested a\n   5. nested b\n1. b\n')).toBe(
        '1. a\n   1. nested a\n   2. nested b\n2. b\n',
      );
    });

    it('handles `)` punctuation as well as `.`', () => {
      expect(run('2) a\n3) b\n')).toBe('1) a\n2) b\n');
    });
  });

  describe('style: same', () => {
    it('rewrites every item as `1.`', () => {
      expect(run('1. a\n2. b\n3. c\n', 'same')).toBe('1. a\n1. b\n1. c\n');
    });

    it('handles nested lists', () => {
      expect(run('1. a\n   2. nested\n3. b\n', 'same')).toBe(
        '1. a\n   1. nested\n1. b\n',
      );
    });
  });

  describe('shared', () => {
    it('does not touch ordered lists inside a code fence', () => {
      const src = '```\n1. a\n5. b\n```\n';
      expect(run(src)).toBe(src);
    });

    it('is idempotent (increment)', () => {
      const once = run('3. a\n4. b\n');
      expect(run(once)).toBe(once);
    });

    it('is idempotent (same)', () => {
      const once = run('1. a\n2. b\n', 'same');
      expect(run(once, 'same')).toBe(once);
    });
  });
});
