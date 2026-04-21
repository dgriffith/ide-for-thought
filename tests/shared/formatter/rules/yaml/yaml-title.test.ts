import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/yaml-title';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, direction: 'heading-to-yaml' | 'yaml-to-heading') {
  return formatContent(content, {
    enabled: { 'yaml-title': true },
    configs: { 'yaml-title': { direction } },
  });
}

describe('yaml-title (#155)', () => {
  describe('direction: heading-to-yaml', () => {
    it('copies the first H1 text into the frontmatter title', () => {
      const out = run('---\ntitle: old\n---\n\n# The Real Title\n\nbody\n', 'heading-to-yaml');
      expect(out).toContain('title: The Real Title');
    });

    it('inserts the title key when missing', () => {
      const out = run('---\nauthor: Alice\n---\n\n# Hello\n', 'heading-to-yaml');
      expect(out).toContain('title: Hello');
    });

    it('is a no-op when no H1 exists', () => {
      const src = '---\ntitle: foo\n---\n\n## only h2\n';
      expect(run(src, 'heading-to-yaml')).toBe(src);
    });

    it('is a no-op when title already matches H1', () => {
      const src = '---\ntitle: Same\n---\n\n# Same\n';
      expect(run(src, 'heading-to-yaml')).toBe(src);
    });
  });

  describe('direction: yaml-to-heading', () => {
    it('rewrites the first H1 to match the frontmatter title', () => {
      const out = run('---\ntitle: The Right Title\n---\n\n# Wrong Title\n', 'yaml-to-heading');
      expect(out).toContain('# The Right Title');
      expect(out).not.toContain('# Wrong Title');
    });

    it('leaves the H1 alone when no title key exists', () => {
      const src = '---\nauthor: Alice\n---\n\n# Existing\n';
      expect(run(src, 'yaml-to-heading')).toBe(src);
    });

    it('does not insert an H1 when none exists (that is file-name-heading\'s job)', () => {
      const src = '---\ntitle: Foo\n---\n\nbody\n';
      expect(run(src, 'yaml-to-heading')).toBe(src);
    });
  });

  describe('shared', () => {
    it('ignores `#` inside a code fence', () => {
      const src = '---\ntitle: Real\n---\n\n```\n# Not real\n```\n';
      expect(run(src, 'heading-to-yaml')).toBe(src);
    });

    it('is idempotent (heading-to-yaml)', () => {
      const once = run('---\ntitle: old\n---\n\n# New\n', 'heading-to-yaml');
      expect(run(once, 'heading-to-yaml')).toBe(once);
    });
  });
});
