import { describe, it, expect } from 'vitest';
import {
  rewriteWikiLinks,
  rewriteRelativeMarkdownLinks,
  normalizePath,
} from '../../../src/main/notebase/link-rewriting';

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

describe('rewriteRelativeMarkdownLinks', () => {
  const empty = new Map<string, string>();

  it('passes content through when source unmoved and rewrites empty', () => {
    const md = 'See [foo](./other.md) and ![](pic.png).\n';
    expect(rewriteRelativeMarkdownLinks(md, 'notes/a.md', 'notes/a.md', empty)).toBe(md);
  });

  it('leaves URL-scheme targets alone', () => {
    const md = 'See [a](https://example.com), [b](mailto:x@y.z), [c](data:image/png;base64,abc).\n';
    const out = rewriteRelativeMarkdownLinks(md, 'notes/a.md', 'notes/b.md', empty);
    expect(out).toBe(md);
  });

  it('leaves bare anchors alone', () => {
    const md = 'See [overview](#section).\n';
    const out = rewriteRelativeMarkdownLinks(md, 'notes/a.md', 'sub/a.md', empty);
    expect(out).toBe(md);
  });

  it('rewrites a link to a moved target file (source unmoved)', () => {
    const md = 'See [foo](./foo.md) for context.\n';
    const out = rewriteRelativeMarkdownLinks(
      md,
      'notes/a.md',
      'notes/a.md',
      map([['notes/foo.md', 'archive/foo.md']]),
    );
    expect(out).toBe('See [foo](../archive/foo.md) for context.\n');
  });

  it('re-relativizes outbound links when the source moves', () => {
    // notes/a.md → notes/sub/a.md. The relative ./other.md target
    // (notes/other.md) needs to become ../other.md from the new
    // location.
    const md = 'See [other](./other.md).\n';
    const out = rewriteRelativeMarkdownLinks(md, 'notes/a.md', 'notes/sub/a.md', empty);
    expect(out).toBe('See [other](../other.md).\n');
  });

  it('handles ../ parent paths', () => {
    // notes/sub/a.md links to ../shared.md (= notes/shared.md). After
    // moving the source to notes/shared/a.md, the same target needs
    // ./shared.md.
    const md = 'See [s](../shared.md).\n';
    const out = rewriteRelativeMarkdownLinks(md, 'notes/sub/a.md', 'notes/shared/a.md', empty);
    expect(out).toBe('See [s](../shared.md).\n'); // notes/shared.md from notes/shared/a.md is `../shared.md`
  });

  it('rewrites image refs the same way as text links', () => {
    const md = '![alt](./pic.png)\n';
    const out = rewriteRelativeMarkdownLinks(
      md,
      'notes/a.md',
      'notes/a.md',
      map([['notes/pic.png', 'assets/pic.png']]),
    );
    expect(out).toBe('![alt](../assets/pic.png)\n');
  });

  it('preserves anchor fragments on the target', () => {
    const md = '[heading](./foo.md#section).\n';
    const out = rewriteRelativeMarkdownLinks(
      md,
      'notes/a.md',
      'notes/a.md',
      map([['notes/foo.md', 'archive/foo.md']]),
    );
    expect(out).toBe('[heading](../archive/foo.md#section).\n');
  });

  it('preserves the optional title attribute', () => {
    const md = '[t](./foo.md "Foo title").\n';
    const out = rewriteRelativeMarkdownLinks(
      md,
      'notes/a.md',
      'notes/a.md',
      map([['notes/foo.md', 'archive/foo.md']]),
    );
    expect(out).toBe('[t](../archive/foo.md "Foo title").\n');
  });

  it('decodes URL-encoded paths and re-encodes the result', () => {
    const md = '[t](./my%20note.md)\n';
    const out = rewriteRelativeMarkdownLinks(
      md,
      'notes/a.md',
      'notes/a.md',
      map([['notes/my note.md', 'archive/my note.md']]),
    );
    expect(out).toBe('[t](../archive/my%20note.md)\n');
  });

  it('leaves links that escape the project root alone', () => {
    const md = '[escape](../../../outside.md)\n';
    const out = rewriteRelativeMarkdownLinks(md, 'notes/a.md', 'notes/sub/a.md', empty);
    expect(out).toBe(md);
  });

  it('handles both source-moved and target-moved in a single link', () => {
    // notes/a.md links to ./foo.md (= notes/foo.md). Both move:
    // a.md → archive/a.md, foo.md → archive/foo.md. Result should
    // be ./foo.md (sibling in the new location).
    const md = '[foo](./foo.md)\n';
    const out = rewriteRelativeMarkdownLinks(
      md,
      'notes/a.md',
      'archive/a.md',
      map([
        ['notes/a.md', 'archive/a.md'],
        ['notes/foo.md', 'archive/foo.md'],
      ]),
    );
    expect(out).toBe('[foo](./foo.md)\n');
  });
});
