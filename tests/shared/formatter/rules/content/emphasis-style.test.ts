import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/emphasis-style';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, style: 'asterisk' | 'underscore' = 'asterisk') {
  return formatContent(content, {
    enabled: { 'emphasis-style': true },
    configs: { 'emphasis-style': { style } },
  });
}

describe('emphasis-style (#157)', () => {
  describe('style: asterisk (default)', () => {
    it('converts `_word_` to `*word*`', () => {
      expect(run('_hello_')).toBe('*hello*');
    });

    it('leaves `*word*` alone', () => {
      expect(run('*hello*')).toBe('*hello*');
    });

    it('does not touch `__strong__` double underscores', () => {
      expect(run('__bold__')).toBe('__bold__');
    });

    it('does not touch in-word underscores (snake_case)', () => {
      expect(run('snake_case_ident')).toBe('snake_case_ident');
    });

    it('handles multiple spans on one line', () => {
      expect(run('_one_ and _two_')).toBe('*one* and *two*');
    });
  });

  describe('style: underscore', () => {
    it('converts `*word*` to `_word_`', () => {
      expect(run('*hello*', 'underscore')).toBe('_hello_');
    });

    it('leaves `_word_` alone', () => {
      expect(run('_hello_', 'underscore')).toBe('_hello_');
    });

    it('does not touch `**strong**` double asterisks', () => {
      expect(run('**bold**', 'underscore')).toBe('**bold**');
    });

    it('does not touch an unordered-list `*` marker', () => {
      expect(run('* item one\n* item two\n', 'underscore')).toBe(
        '* item one\n* item two\n',
      );
    });
  });

  describe('shared', () => {
    it('does not touch emphasis inside code fences', () => {
      const src = '```\n_code_\n```\n';
      expect(run(src)).toBe(src);
    });

    it('is idempotent (asterisk)', () => {
      const once = run('_hello_');
      expect(run(once)).toBe(once);
    });

    it('is idempotent (underscore)', () => {
      const once = run('*hello*', 'underscore');
      expect(run(once, 'underscore')).toBe(once);
    });
  });
});
