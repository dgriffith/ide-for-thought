import { describe, it, expect } from 'vitest';
import {
  relocateWikiLinks,
  rewriteRelativeMarkdownLinks,
  normalizePath,
  type WikiRelocation,
} from '../../../src/main/notebase/link-rewriting';
import { relocationIndexesFrom } from '../../../src/main/graph/note-index';

const map = (pairs: [string, string][]) => new Map(pairs);

describe('normalizePath', () => {
  it('strips a trailing .md', () => {
    expect(normalizePath('notes/foo.md')).toBe('notes/foo');
  });

  it('leaves non-.md paths alone', () => {
    expect(normalizePath('notes/foo')).toBe('notes/foo');
  });
});

/**
 * Example cases for the resolver-driven wiki-link rewriter (#2456). These were
 * the unit tests of the path-keyed `rewriteWikiLinks` it replaced; each one
 * still describes what a rename must do, so they moved here rather than going
 * with it. `tests/property/link-rewriting.property.test.ts` covers the same
 * ground generatively.
 */
describe('relocateWikiLinks', () => {
  const NOTES = ['notes/foo.md', 'notes/bar.md', 'notes/a.md', 'notes/b.md', 'notes/c.md', 'readme.md'];

  function relocate(content: string, moves: [string, string][], paths: string[] = NOTES): string {
    const m = new Map(moves);
    const reloc: WikiRelocation = {
      moves: m,
      ...relocationIndexesFrom(paths, new Map(), m, { carryAliases: true }),
    };
    return relocateWikiLinks(content, reloc).content;
  }
  const FOO: [string, string][] = [['notes/foo.md', 'archive/foo.md']];

  it('returns input unchanged when nothing moved', () => {
    expect(relocateWikiLinks('[[notes/foo]]', {
      moves: new Map(),
      ...relocationIndexesFrom(NOTES, new Map(), new Map(), { carryAliases: true }),
    })).toEqual({ content: '[[notes/foo]]', rewritten: 0 });
  });

  it('rewrites a simple wiki-link and counts it', () => {
    const m = new Map(FOO);
    const out = relocateWikiLinks('See [[notes/foo]].', {
      moves: m, ...relocationIndexesFrom(NOTES, new Map(), m, { carryAliases: true }),
    });
    expect(out).toEqual({ content: 'See [[archive/foo]].', rewritten: 1 });
  });

  it('preserves display text', () => {
    expect(relocate('See [[notes/foo|the foo note]].', FOO)).toBe('See [[archive/foo|the foo note]].');
  });

  it('preserves the type prefix on typed links', () => {
    expect(relocate('It [[supports::notes/foo]] the claim.', FOO)).toBe('It [[supports::archive/foo]] the claim.');
  });

  it('preserves anchor suffix (headings)', () => {
    expect(relocate('[[notes/foo#components]]', FOO)).toBe('[[archive/foo#components]]');
  });

  it('preserves block-id suffix', () => {
    expect(relocate('[[notes/foo#^p4]]', FOO)).toBe('[[archive/foo#^p4]]');
  });

  it('preserves all three (type + anchor + display)', () => {
    expect(relocate('[[rebuts::notes/foo#section|see section]]', FOO))
      .toBe('[[rebuts::archive/foo#section|see section]]');
  });

  it('preserves the embed marker', () => {
    expect(relocate('![[notes/foo]]', FOO)).toBe('![[archive/foo]]');
  });

  it('preserves a .md suffix when the source had one', () => {
    expect(relocate('[[notes/foo.md]]', FOO)).toBe('[[archive/foo.md]]');
  });

  it('does not add .md when the source did not have one', () => {
    expect(relocate('[[notes/foo]]', FOO)).toBe('[[archive/foo]]');
  });

  it('leaves cite and quote links alone — they use source ids, not paths', () => {
    expect(relocate('[[cite::notes/foo]] and [[quote::notes/foo]]', FOO))
      .toBe('[[cite::notes/foo]] and [[quote::notes/foo]]');
  });

  it('leaves links to notes that did not move alone', () => {
    expect(relocate('[[notes/bar]] [[notes/foo]]', FOO)).toBe('[[notes/bar]] [[archive/foo]]');
  });

  it('leaves a basename link alone when the basename still resolves', () => {
    expect(relocate('[[foo]]', FOO)).toBe('[[foo]]');
  });

  it('handles multiple moves in a single pass', () => {
    const out = relocate(
      '[[notes/a]] links to [[notes/b]] links to [[notes/c]]',
      [['notes/a.md', 'archive/a.md'], ['notes/b.md', 'archive/b.md']],
    );
    expect(out).toBe('[[archive/a]] links to [[archive/b]] links to [[notes/c]]');
  });

  it('rewrites links in frontmatter values too', () => {
    const input = `---
related: "[[notes/foo]]"
---
# My note
See [[notes/foo]].
`;
    const out = relocate(input, FOO);
    expect(out).toContain('related: "[[archive/foo]]"');
    expect(out).toContain('See [[archive/foo]].');
  });

  it('does not rewrite inside fenced code blocks or inline code', () => {
    // The path-keyed rewriter reached into code (a documented limitation);
    // this one skips what the indexer does not read links from.
    expect(relocate('```\n[[notes/foo]]\n```', FOO)).toBe('```\n[[notes/foo]]\n```');
    expect(relocate('`[[notes/foo]]` and [[notes/foo]]', FOO)).toBe('`[[notes/foo]]` and [[archive/foo]]');
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
