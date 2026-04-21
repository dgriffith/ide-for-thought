import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/heading/file-name-heading';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(
  content: string,
  mode: 'off' | 'insert-if-missing' | 'replace-h1',
  filename: string = 'my-note',
) {
  return formatContent(content, {
    enabled: { 'file-name-heading': true },
    configs: { 'file-name-heading': { mode, filename } },
  });
}

describe('file-name-heading (#156)', () => {
  describe('mode: off', () => {
    it('is a no-op even with a mismatched H1', () => {
      const src = '# Wrong\n\nbody\n';
      expect(run(src, 'off')).toBe(src);
    });
  });

  describe('mode: insert-if-missing', () => {
    it('prepends `# <filename>` when no H1 is present', () => {
      expect(run('body\n', 'insert-if-missing', 'my-note')).toBe(
        '# my-note\n\nbody\n',
      );
    });

    it('leaves an existing H1 alone', () => {
      const src = '# Existing\n\nbody\n';
      expect(run(src, 'insert-if-missing', 'my-note')).toBe(src);
    });

    it('leaves an H2 alone when no H1 is present (only cares about H1)', () => {
      expect(run('## only an h2\n', 'insert-if-missing', 'my-note')).toBe(
        '# my-note\n\n## only an h2\n',
      );
    });

    it('inserts after YAML frontmatter when present', () => {
      expect(
        run('---\ntitle: foo\n---\n\nbody\n', 'insert-if-missing', 'my-note'),
      ).toBe('---\ntitle: foo\n---\n\n# my-note\n\nbody\n');
    });

    it('handles empty document', () => {
      expect(run('', 'insert-if-missing', 'my-note')).toBe('# my-note\n');
    });
  });

  describe('mode: replace-h1', () => {
    it('replaces the first H1 text with the filename', () => {
      expect(run('# Something else\n\nbody\n', 'replace-h1', 'my-note')).toBe(
        '# my-note\n\nbody\n',
      );
    });

    it('does not insert an H1 when none exists', () => {
      const src = 'body without a heading\n';
      expect(run(src, 'replace-h1', 'my-note')).toBe(src);
    });

    it('only touches the first H1, leaving later ones alone', () => {
      expect(run('# Old\n\n## sub\n\n# Another\n', 'replace-h1', 'my-note')).toBe(
        '# my-note\n\n## sub\n\n# Another\n',
      );
    });

    it('strips a trailing `#` closing run from the original H1', () => {
      expect(run('# Old title ##\n', 'replace-h1', 'my-note')).toBe(
        '# my-note\n',
      );
    });
  });

  describe('no filename injected', () => {
    // Orchestrator injects the filename; palette calls without a known
    // file (unusual) leave it empty. The rule should treat an empty
    // filename as "no file context available" and do nothing.
    it('is a no-op regardless of mode', () => {
      const src = '# Old\n\nbody\n';
      expect(run(src, 'replace-h1', '')).toBe(src);
      expect(run('body\n', 'insert-if-missing', '')).toBe('body\n');
    });
  });

  describe('shared', () => {
    it('does not treat `#` inside a code fence as H1', () => {
      expect(run('```\n# Fake\n```\n\nbody\n', 'insert-if-missing', 'my-note')).toBe(
        '# my-note\n\n```\n# Fake\n```\n\nbody\n',
      );
    });

    it('is idempotent (insert-if-missing)', () => {
      const once = run('body\n', 'insert-if-missing', 'my-note');
      expect(run(once, 'insert-if-missing', 'my-note')).toBe(once);
    });

    it('is idempotent (replace-h1)', () => {
      const once = run('# Old\n\nbody\n', 'replace-h1', 'my-note');
      expect(run(once, 'replace-h1', 'my-note')).toBe(once);
    });
  });
});
