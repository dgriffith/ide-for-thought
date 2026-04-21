import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/quote-style';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, style?: 'straight' | 'curly') {
  return formatContent(content, {
    enabled: { 'quote-style': true },
    configs: style ? { 'quote-style': { style } } : {},
  });
}

describe('quote-style (#157)', () => {
  describe('style: straight (default)', () => {
    it('converts curly double quotes to straight', () => {
      expect(run('“hello”')).toBe('"hello"');
    });

    it('converts curly single quotes to straight', () => {
      expect(run('‘hi’ and don’t')).toBe("'hi' and don't");
    });

    it('leaves already-straight quotes alone', () => {
      const src = '"hello" and \'hi\'\n';
      expect(run(src)).toBe(src);
    });

    it('does not touch quotes inside a code fence', () => {
      const src = '```\n“keep”\n```\n';
      expect(run(src)).toBe(src);
    });
  });

  describe('style: curly', () => {
    it('converts paired double quotes', () => {
      expect(run('"hello"', 'curly')).toBe('“hello”');
    });

    it('converts paired single quotes surrounded by word boundaries', () => {
      expect(run("say 'hi' now", 'curly')).toBe('say ‘hi’ now');
    });

    it('leaves a lone in-word apostrophe alone', () => {
      const src = "don't do it\n";
      expect(run(src, 'curly')).toBe(src);
    });

    it('leaves unpaired straight quotes alone', () => {
      const src = 'she said "maybe\n';
      expect(run(src, 'curly')).toBe(src);
    });

    it('does not touch quotes inside inline code', () => {
      const src = 'see `"foo"` below\n';
      expect(run(src, 'curly')).toBe(src);
    });
  });

  describe('shared', () => {
    it('is idempotent (straight)', () => {
      const once = run('“hello”');
      expect(run(once)).toBe(once);
    });

    it('is idempotent (curly)', () => {
      const once = run('"hello"', 'curly');
      expect(run(once, 'curly')).toBe(once);
    });
  });
});
