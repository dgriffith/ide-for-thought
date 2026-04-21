import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/minerva/canonical-wiki-link-extension';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, extension: 'never' | 'always') {
  return formatContent(content, {
    enabled: { 'canonical-wiki-link-extension': true },
    configs: { 'canonical-wiki-link-extension': { extension } },
  });
}

describe('canonical-wiki-link-extension (#161)', () => {
  describe('extension: never', () => {
    it('strips `.md` from wiki-link targets', () => {
      expect(run('[[notes/foo.md]]', 'never')).toBe('[[notes/foo]]');
    });

    it('preserves type prefixes, anchors, and display aliases', () => {
      expect(run('[[notes/foo.md#section|Label]]', 'never')).toBe(
        '[[notes/foo#section|Label]]',
      );
    });

    it('leaves links without `.md` alone', () => {
      const src = '[[notes/foo]]';
      expect(run(src, 'never')).toBe(src);
    });
  });

  describe('extension: always', () => {
    it('adds `.md` to wiki-link targets', () => {
      expect(run('[[notes/foo]]', 'always')).toBe('[[notes/foo.md]]');
    });

    it('leaves links that already have `.md` alone', () => {
      const src = '[[notes/foo.md]]';
      expect(run(src, 'always')).toBe(src);
    });
  });

  describe('shared', () => {
    it('does not touch typed links (cite/quote)', () => {
      const src = '[[cite::some-source]] and [[quote::an-excerpt]]';
      expect(run(src, 'always')).toBe(src);
      expect(run(src, 'never')).toBe(src);
    });

    it('does not touch wiki-links inside a code fence', () => {
      const src = '```\n[[notes/foo.md]]\n```\n';
      expect(run(src, 'never')).toBe(src);
    });

    it('is idempotent', () => {
      const once = run('[[notes/foo.md]]', 'never');
      expect(run(once, 'never')).toBe(once);
    });
  });
});
