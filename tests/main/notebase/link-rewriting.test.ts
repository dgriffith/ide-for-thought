import { describe, it, expect } from 'vitest';
import { rewriteWikiLinks, normalizePath } from '../../../src/main/notebase/link-rewriting';

const map = (pairs: [string, string][]) => new Map(pairs);

describe('normalizePath', () => {
  it('strips a trailing .md', () => {
    expect(normalizePath('notes/foo.md')).toBe('notes/foo');
  });

  it('leaves non-.md paths alone', () => {
    expect(normalizePath('notes/foo')).toBe('notes/foo');
  });
});

describe('rewriteWikiLinks', () => {
  it('returns input unchanged when rewrites is empty', () => {
    expect(rewriteWikiLinks('[[foo]]', new Map())).toBe('[[foo]]');
  });

  it('rewrites a simple wiki-link', () => {
    const out = rewriteWikiLinks('See [[notes/foo]].', map([['notes/foo', 'archive/foo']]));
    expect(out).toBe('See [[archive/foo]].');
  });

  it('preserves display text', () => {
    const out = rewriteWikiLinks('See [[notes/foo|the foo note]].', map([['notes/foo', 'archive/foo']]));
    expect(out).toBe('See [[archive/foo|the foo note]].');
  });

  it('preserves the type prefix on typed links', () => {
    const out = rewriteWikiLinks(
      'It [[supports::notes/foo]] the claim.',
      map([['notes/foo', 'archive/foo']]),
    );
    expect(out).toBe('It [[supports::archive/foo]] the claim.');
  });

  it('preserves anchor suffix (headings)', () => {
    const out = rewriteWikiLinks('[[notes/foo#components]]', map([['notes/foo', 'archive/foo']]));
    expect(out).toBe('[[archive/foo#components]]');
  });

  it('preserves block-id suffix', () => {
    const out = rewriteWikiLinks('[[notes/foo#^p4]]', map([['notes/foo', 'archive/foo']]));
    expect(out).toBe('[[archive/foo#^p4]]');
  });

  it('preserves all three (type + anchor + display)', () => {
    const out = rewriteWikiLinks(
      '[[rebuts::notes/foo#section|see section]]',
      map([['notes/foo', 'archive/foo']]),
    );
    expect(out).toBe('[[rebuts::archive/foo#section|see section]]');
  });

  it('preserves a .md suffix when the source had one', () => {
    const out = rewriteWikiLinks('[[notes/foo.md]]', map([['notes/foo', 'archive/foo']]));
    expect(out).toBe('[[archive/foo.md]]');
  });

  it('does not add .md when the source did not have one', () => {
    const out = rewriteWikiLinks('[[notes/foo]]', map([['notes/foo', 'archive/foo']]));
    expect(out).toBe('[[archive/foo]]');
  });

  it('leaves cite links alone — they use source ids, not paths', () => {
    const out = rewriteWikiLinks(
      '[[cite::notes/foo]] and [[quote::notes/foo]]',
      map([['notes/foo', 'archive/foo']]),
    );
    expect(out).toBe('[[cite::notes/foo]] and [[quote::notes/foo]]');
  });

  it('leaves non-matching targets alone', () => {
    const out = rewriteWikiLinks('[[notes/bar]] [[notes/foo]]', map([['notes/foo', 'archive/foo']]));
    expect(out).toBe('[[notes/bar]] [[archive/foo]]');
  });

  it('handles multiple rewrites in a single pass', () => {
    const out = rewriteWikiLinks(
      '[[notes/a]] links to [[notes/b]] links to [[notes/c]]',
      map([
        ['notes/a', 'archive/a'],
        ['notes/b', 'archive/b'],
      ]),
    );
    expect(out).toBe('[[archive/a]] links to [[archive/b]] links to [[notes/c]]');
  });

  it('rewrites links in frontmatter values too (regex covers the whole file)', () => {
    const input = `---
related: "[[notes/foo]]"
---
# My note
See [[notes/foo]].
`;
    const out = rewriteWikiLinks(input, map([['notes/foo', 'archive/foo']]));
    expect(out).toContain('related: "[[archive/foo]]"');
    expect(out).toContain('See [[archive/foo]].');
  });

  it('does not rewrite inside fenced code blocks (known limitation — regex is whole-file)', () => {
    // This documents current behavior. Rewriting inside code fences is a
    // scoped future change; today a plain regex reaches in.
    const out = rewriteWikiLinks(
      '```\n[[notes/foo]]\n```',
      map([['notes/foo', 'archive/foo']]),
    );
    expect(out).toBe('```\n[[archive/foo]]\n```');
  });
});
