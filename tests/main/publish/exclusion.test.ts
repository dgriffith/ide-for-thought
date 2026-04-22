import { describe, it, expect } from 'vitest';
import { checkExclusion, isUnderPrivateFolder, hasInlinePrivateTag } from '../../../src/main/publish/exclusion';

describe('isUnderPrivateFolder', () => {
  it('matches a top-level private/ path', () => {
    expect(isUnderPrivateFolder('private/secret.md')).toBe(true);
    expect(isUnderPrivateFolder('.private/secret.md')).toBe(true);
  });

  it('matches nested private/ paths', () => {
    expect(isUnderPrivateFolder('notes/private/secret.md')).toBe(true);
    expect(isUnderPrivateFolder('a/b/.private/c/d.md')).toBe(true);
  });

  it('does not match paths that just contain the word "private"', () => {
    expect(isUnderPrivateFolder('notes/privateish.md')).toBe(false);
    expect(isUnderPrivateFolder('research/privacy-law.md')).toBe(false);
  });
});

describe('hasInlinePrivateTag', () => {
  it('matches #private at word boundaries in the body', () => {
    expect(hasInlinePrivateTag('# A note\n\nThis is #private\n')).toBe(true);
    expect(hasInlinePrivateTag('(#private)')).toBe(true);
  });

  it('ignores #private inside a YAML frontmatter block', () => {
    const content = '---\nexample: "#private"\n---\n\nPlain body.\n';
    expect(hasInlinePrivateTag(content)).toBe(false);
  });

  it('ignores #privateish substrings', () => {
    expect(hasInlinePrivateTag('Tags: #privateish\n')).toBe(false);
  });
});

describe('checkExclusion (#246)', () => {
  it('passes a normal public note', () => {
    const content = '---\ntitle: Public\n---\n\n# Public\nBody.\n';
    expect(checkExclusion('notes/public.md', content)).toEqual({ excluded: false });
  });

  it('excludes anything under private/', () => {
    const out = checkExclusion('private/secret.md', '# Secret\n');
    expect(out.excluded).toBe(true);
    expect(out.reason).toMatch(/under private\//);
  });

  it('excludes frontmatter `private: true`', () => {
    const content = '---\nprivate: true\n---\n\n# Whatever\n';
    expect(checkExclusion('notes/x.md', content))
      .toEqual({ excluded: true, reason: 'frontmatter `private: true`' });
  });

  it('does NOT exclude `private: false`', () => {
    const content = '---\nprivate: false\n---\n\n# Whatever\n';
    expect(checkExclusion('notes/x.md', content)).toEqual({ excluded: false });
  });

  it('excludes frontmatter tags list that contains `private`', () => {
    const content = '---\ntags: [draft, private, todo]\n---\n\nbody\n';
    expect(checkExclusion('notes/x.md', content))
      .toEqual({ excluded: true, reason: 'tagged #private' });
  });

  it('excludes block-list frontmatter tags with `- private`', () => {
    const content = '---\ntags:\n  - draft\n  - private\n  - todo\n---\n\nbody\n';
    expect(checkExclusion('notes/x.md', content))
      .toEqual({ excluded: true, reason: 'tagged #private' });
  });

  it('excludes an inline #private body tag when no frontmatter flags match', () => {
    const content = '# Some note\n\nAnd a #private sidebar.\n';
    expect(checkExclusion('notes/x.md', content))
      .toEqual({ excluded: true, reason: 'tagged #private' });
  });

  it('returns the first-matching reason when several apply', () => {
    // Path check wins: short-circuits before frontmatter is read.
    const content = '---\nprivate: true\ntags: [private]\n---\n#private\n';
    expect(checkExclusion('private/x.md', content).reason).toMatch(/under private\//);
  });
});
