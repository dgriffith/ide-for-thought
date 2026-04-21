import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/strong-style';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, style: 'asterisk' | 'underscore' = 'asterisk') {
  return formatContent(content, {
    enabled: { 'strong-style': true },
    configs: { 'strong-style': { style } },
  });
}

describe('strong-style (#157)', () => {
  describe('style: asterisk (default)', () => {
    it('converts `__word__` to `**word**`', () => {
      expect(run('__hello__')).toBe('**hello**');
    });

    it('leaves `**word**` alone', () => {
      expect(run('**hello**')).toBe('**hello**');
    });

    it('does not touch single `_word_` emphasis', () => {
      expect(run('_italic_')).toBe('_italic_');
    });
  });

  describe('style: underscore', () => {
    it('converts `**word**` to `__word__`', () => {
      expect(run('**hello**', 'underscore')).toBe('__hello__');
    });

    it('leaves `__word__` alone', () => {
      expect(run('__hello__', 'underscore')).toBe('__hello__');
    });

    it('does not touch single `*word*` emphasis', () => {
      expect(run('*italic*', 'underscore')).toBe('*italic*');
    });
  });

  describe('shared', () => {
    it('does not touch strong emphasis inside code fences', () => {
      const src = '```\n__bold__\n```\n';
      expect(run(src)).toBe(src);
    });

    it('handles multiple spans on one line', () => {
      expect(run('__a__ and __b__')).toBe('**a** and **b**');
    });

    it('is idempotent (asterisk)', () => {
      const once = run('__hello__');
      expect(run(once)).toBe(once);
    });

    it('is idempotent (underscore)', () => {
      const once = run('**hello**', 'underscore');
      expect(run(once, 'underscore')).toBe(once);
    });
  });
});
